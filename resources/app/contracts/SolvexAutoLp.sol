// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IPancakeV2PairLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function totalSupply() external view returns (uint256);
}
interface IPancakeV2FactoryLike {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}
interface IPancakeV2RouterLike {
    function factory() external view returns (address);
    function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)
        external returns (uint256,uint256,uint256);
}
interface ISolvexLaunchToken {
    function openTradingFromLiquidity() external;
    function launchController() external view returns (address);
    function tradingEnabled() external view returns (bool);
    function isExempt(address) external view returns (bool);
    function isAMMPair(address) external view returns (bool);
}

/**
 * SVX inventory + blindbox receipts + daily withdrawal-fee receipts -> Pancake V2 LP.
 * Funding never depends on inventory availability. A keeper/operator executes LP transactions.
 * A plain ERC20 transfer has no callback; processLiquidity/deposit must be called separately.
 * USDT and SVX are fixed at deployment. LP is owner-controlled, NOT timelocked.
 * Daily settlement uses completed Beijing (UTC+8) calendar days; no on-chain timer exists.
 */
contract SolvexAutoLp is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable svx;
    IERC20 public immutable usdt;
    IPancakeV2RouterLike public immutable router;
    IPancakeV2PairLike public immutable pair;
    uint8 public immutable svxDecimals;
    uint8 public immutable usdtDecimals;
    uint256 public immutable launchThresholdUsdt;
    uint256 public immutable blindboxPriceUsdt;
    uint256 public constant UTC8_OFFSET = 8 hours;

    address public lpRecipient;
    uint256 public slippageBps = 100;
    uint256 public minAddUsdt;
    uint256 public minLiquidity = 1000;
    uint256 public bootstrapSvxPerUsdt = 10e18;
    uint256 public deadlineSeconds = 300;
    bool public paused;
    bool public launched;
    mapping(address => bool) public operators;
    mapping(bytes32 => bool) public usedJobs;
    mapping(bytes32 => bool) public usedReceipts;
    mapping(uint256 => uint256) public withdrawalFeesByDay;
    mapping(uint256 => bool) public settledDays;
    uint256 public svxDeposited;
    uint256 public totalSvxAdded;
    uint256 public totalUsdtAdded;
    uint256 public totalLpMinted;
    uint256 public totalBlindboxUsdt;
    uint256 public totalWithdrawalFeeUsdt;

    event SvxDeposited(address indexed from, uint256 amount, uint256 availableSvx);
    event FundsReceived(address indexed from, bytes32 indexed receiptKey, uint8 source, uint256 usdtAmount, uint256 businessDay);
    event LiquidityAdded(address indexed operator, bytes32 indexed jobKey, uint256 usdtUsed, uint256 svxUsed, uint256 lpMinted, uint256 priceUsdtPerSvx1e18);
    event OperatorUpdated(address indexed operator, bool allowed);
    event LpRecipientUpdated(address indexed recipient);
    event ParamsUpdated(uint256 slippageBps, uint256 minAddUsdt, uint256 minLiquidity, uint256 bootstrapSvxPerUsdt, uint256 deadlineSeconds);
    event PausedStateChanged(bool paused);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    event NativeRescued(address indexed to, uint256 amount);
    event LpEmergencyWithdrawn(address indexed to, uint256 amount);
    event TradingOpened(uint256 usdtReserve, uint256 cumulativeUsdtAdded);

    modifier onlyOperator() {
        require(msg.sender == owner() || operators[msg.sender], "AutoLP: not operator");
        _;
    }
    modifier whenNotPaused() { require(!paused, "AutoLP: paused"); _; }

    constructor(address initialOwner, address svx_, address usdt_, address router_, address pair_) Ownable(initialOwner) {
        require(svx_ != usdt_ && svx_.code.length > 0 && usdt_.code.length > 0 && router_.code.length > 0, "AutoLP: invalid contracts");
        svx = IERC20(svx_);
        usdt = IERC20(usdt_);
        router = IPancakeV2RouterLike(router_);
        svxDecimals = IERC20Metadata(svx_).decimals();
        usdtDecimals = IERC20Metadata(usdt_).decimals();
        require(svxDecimals <= 18 && usdtDecimals <= 18, "AutoLP: unsupported decimals");
        launchThresholdUsdt = 500_000 * 10 ** usdtDecimals;
        blindboxPriceUsdt = 10 ** usdtDecimals;
        minAddUsdt = blindboxPriceUsdt;
        IPancakeV2FactoryLike factory = IPancakeV2FactoryLike(router.factory());
        address resolved = factory.getPair(svx_, usdt_);
        if (resolved == address(0)) resolved = factory.createPair(svx_, usdt_);
        require(pair_ == address(0) || pair_ == resolved, "AutoLP: factory pair mismatch");
        pair = IPancakeV2PairLike(resolved);
        require((pair.token0() == svx_ && pair.token1() == usdt_) ||
                (pair.token0() == usdt_ && pair.token1() == svx_), "AutoLP: token pair mismatch");
        lpRecipient = address(this);
    }

    /// @notice Direct SVX transfers are also usable; this method records explicit deposits.
    function depositSvx(uint256 amount) external onlyOperator nonReentrant {
        require(amount > 0, "AutoLP: zero amount");
        uint256 beforeBalance = availableSvx();
        svx.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = availableSvx() - beforeBalance;
        require(received == amount, "AutoLP: taxed inventory");
        svxDeposited += received;
        emit SvxDeposited(msg.sender, received, availableSvx());
    }
    function availableSvx() public view returns (uint256) { return svx.balanceOf(address(this)); }

    /// @notice Pulls 1 USDT from the buyer and adds matching SVX liquidity atomically.
    function buyBlindboxAndAddLiquidity(bytes32 receiptKey, uint256 quotedSvxPerUsdt, uint256 deadline)
        external whenNotPaused nonReentrant
    {
        require(receiptKey != bytes32(0), "AutoLP: receipt key required");
        bytes32 receiptId = keccak256(abi.encode(uint8(1), msg.sender, receiptKey));
        _receiveFunds(blindboxPriceUsdt, receiptId, receiptKey, 1, 0);
        totalBlindboxUsdt += blindboxPriceUsdt;
        _addLiquidity(
            blindboxPriceUsdt,
            keccak256(abi.encodePacked("blindbox", msg.sender, receiptKey)),
            quotedSvxPerUsdt,
            deadline
        );
    }

    /// @notice Transfer the off-chain 2% fee total ONCE for a completed Beijing business day.
    /// businessDay = floor((unixTimestamp + 8 hours) / 1 days). Amount is supplied by the platform.
    function fundWithdrawalFees(uint256 amount, uint256 businessDay, bytes32 receiptKey)
        external onlyOperator whenNotPaused nonReentrant
    {
        require(businessDay < (block.timestamp + UTC8_OFFSET) / 1 days, "AutoLP: business day not closed");
        require(!settledDays[businessDay], "AutoLP: day already settled");
        settledDays[businessDay] = true;
        _receiveFunds(amount, keccak256(abi.encode(uint8(2), businessDay)), receiptKey, 2, businessDay);
        withdrawalFeesByDay[businessDay] = amount;
        totalWithdrawalFeeUsdt += amount;
    }

    /// @notice For platform-side batch blindbox funding; use a globally unique receiptKey.
    function fundBlindboxBatch(uint256 count, bytes32 receiptKey) external onlyOperator whenNotPaused nonReentrant {
        require(count > 0, "AutoLP: zero count");
        uint256 amount = count * blindboxPriceUsdt;
        _receiveFunds(amount, keccak256(abi.encode(uint8(3), receiptKey)), receiptKey, 1, 0);
        totalBlindboxUsdt += amount;
    }
    function _receiveFunds(uint256 amount, bytes32 key, bytes32 receiptKey, uint8 source, uint256 day) private {
        require(amount > 0 && receiptKey != bytes32(0), "AutoLP: amount/key required");
        require(!usedReceipts[key], "AutoLP: receipt already used");
        usedReceipts[key] = true;
        uint256 beforeBalance = usdt.balanceOf(address(this));
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        require(usdt.balanceOf(address(this)) - beforeBalance == amount, "AutoLP: taxed USDT unsupported");
        emit FundsReceived(msg.sender, receiptKey, source, amount, day);
    }

    /// @notice Legacy atomic funding+LP entry, suitable only BEFORE launch (fixed bootstrap quote).
    function addLiquidity(uint256 amount, bytes32 jobKey) external onlyOperator whenNotPaused nonReentrant {
        require(!launched, "AutoLP: use bounded processLiquidity");
        uint256 beforeBalance = usdt.balanceOf(address(this));
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        require(usdt.balanceOf(address(this)) - beforeBalance == amount, "AutoLP: taxed USDT unsupported");
        _addLiquidity(amount, jobKey, bootstrapSvxPerUsdt, block.timestamp + deadlineSeconds);
    }
    /// @notice Legacy prefunded entry; after launch an explicit off-chain quote is mandatory.
    function deposit(uint256 amount, bytes32 jobKey) external onlyOperator whenNotPaused nonReentrant {
        require(!launched, "AutoLP: use bounded processLiquidity");
        _addLiquidity(amount, jobKey, bootstrapSvxPerUsdt, block.timestamp + deadlineSeconds);
    }
    /// @notice Quote is SVX per USDT with 1e18 precision, computed BEFORE broadcasting.
    /// This is a bounded operator quote, NOT an oracle or comprehensive MEV protection.
    function processLiquidity(uint256 amount, bytes32 jobKey, uint256 quotedSvxPerUsdt, uint256 deadline)
        external onlyOperator whenNotPaused nonReentrant
    {
        _addLiquidity(amount, jobKey, quotedSvxPerUsdt, deadline);
    }
    function _addLiquidity(uint256 amount, bytes32 jobKey, uint256 quote, uint256 deadline) private {
        require(amount >= minAddUsdt && usdt.balanceOf(address(this)) >= amount, "AutoLP: insufficient/min USDT");
        require(jobKey != bytes32(0) && !usedJobs[jobKey], "AutoLP: invalid/used job");
        require(deadline >= block.timestamp && deadline <= block.timestamp + deadlineSeconds, "AutoLP: expired/long deadline");
        ISolvexLaunchToken token = ISolvexLaunchToken(address(svx));
        require(token.isExempt(address(this)), "AutoLP: token fee exemption missing");
        require(token.launchController() == address(this), "AutoLP: controller not bound");
        (uint256 ru, uint256 rs, uint256 supply) = _reserves();
        uint256 ratio = ru > 0 && rs > 0 ? _ratio(ru, rs) : bootstrapSvxPerUsdt;
        // Before opening, no trading should move the initial ratio. Reject donated/manipulated ratios.
        _checkQuote(ratio, launched ? quote : bootstrapSvxPerUsdt);
        _checkQuote(ratio, quote);
        (uint256 uu, uint256 ss) = _computeAmounts(amount, ru, rs);
        require(uu >= minAddUsdt && ss > 0, "AutoLP: insufficient SVX inventory");
        usedJobs[jobKey] = true;
        svx.forceApprove(address(router), ss);
        usdt.forceApprove(address(router), uu);
        (uint256 spentU, uint256 spentS, uint256 minted) = _executeLiquidity(uu, ss, deadline);
        if (supply > 0) {
            uint256 expected = Math.min(Math.mulDiv(uu,supply,ru), Math.mulDiv(ss,supply,rs));
            require(minted >= Math.mulDiv(expected,10000-slippageBps,10000), "AutoLP: LP slippage");
        }
        totalUsdtAdded += spentU;
        totalSvxAdded += spentS;
        totalLpMinted += minted;
        emit LiquidityAdded(msg.sender, jobKey, spentU, spentS, minted, Math.mulDiv(spentU * 10 ** svxDecimals, 1e18, spentS * 10 ** usdtDecimals));
        if (!launched && liquidityReady()) _openTrading();
        // Unused USDT stays protected in the contract.
    }
    function _executeLiquidity(uint256 uu, uint256 ss, uint256 deadline) private returns (uint256 spentU, uint256 spentS, uint256 minted) {
        uint256 beforeU = usdt.balanceOf(address(this));
        uint256 beforeS = availableSvx();
        uint256 beforeLp = IERC20(address(pair)).balanceOf(lpRecipient);
        (,,minted) = router.addLiquidity(address(usdt), address(svx), uu, ss,
            Math.mulDiv(uu, 10000-slippageBps, 10000), Math.mulDiv(ss, 10000-slippageBps, 10000), lpRecipient, deadline);
        spentU = beforeU - usdt.balanceOf(address(this));
        spentS = beforeS - availableSvx();
        svx.forceApprove(address(router), 0);
        usdt.forceApprove(address(router), 0);
        require(spentU > 0 && spentS > 0 && spentU <= uu && spentS <= ss, "AutoLP: invalid amounts");
        require(minted >= minLiquidity && IERC20(address(pair)).balanceOf(lpRecipient) - beforeLp == minted, "AutoLP: LP minimum/mismatch");
    }
    function _checkQuote(uint256 actual, uint256 quote) private view {
        require(quote > 0 && Math.mulDiv(actual > quote ? actual-quote : quote-actual, 10000, quote) <= slippageBps, "AutoLP: quote moved");
    }
    function _ratio(uint256 ru, uint256 rs) private view returns (uint256) {
        return Math.mulDiv(rs * 10 ** usdtDecimals, 1e18, ru * 10 ** svxDecimals);
    }
    function currentSvxPerUsdt() external view returns (uint256) {
        (uint256 ru,uint256 rs,) = _reserves();
        return ru > 0 && rs > 0 ? _ratio(ru,rs) : bootstrapSvxPerUsdt;
    }
    function _computeAmounts(uint256 amount, uint256 ru, uint256 rs) private view returns (uint256 uu, uint256 ss) {
        require((ru == 0) == (rs == 0), "AutoLP: one sided reserves");
        ss = ru > 0 ? Math.mulDiv(amount,rs,ru) : Math.mulDiv(amount * 10 ** svxDecimals, bootstrapSvxPerUsdt, 1e18 * 10 ** usdtDecimals);
        uint256 inventory = availableSvx();
        uu = amount;
        if (ss > inventory) {
            ss = inventory;
            uu = ru > 0 ? Math.mulDiv(ss,ru,rs) : Math.mulDiv(ss * 10 ** usdtDecimals, 1e18, bootstrapSvxPerUsdt * 10 ** svxDecimals);
        }
    }
    function previewAddLiquidity(uint256 amount) external view returns (uint256 uu, uint256 ss) {
        (uint256 ru,uint256 rs,) = _reserves();
        return _computeAmounts(amount,ru,rs);
    }
    function _reserves() private view returns (uint256 ru,uint256 rs,uint256 supply) {
        (uint112 r0,uint112 r1,) = pair.getReserves();
        (ru,rs) = pair.token0() == address(usdt) ? (uint256(r0),uint256(r1)) : (uint256(r1),uint256(r0));
        supply = pair.totalSupply();
    }
    function reserves() external view returns (uint256,uint256,uint256) { return _reserves(); }
    function liquidityReady() public view returns (bool) {
        (uint256 ru,uint256 rs,uint256 supply) = _reserves();
        return ru >= launchThresholdUsdt && rs > 0 && supply > 0;
    }
    function openTrading() external whenNotPaused nonReentrant {
        require(!launched && liquidityReady(), "AutoLP: not ready/already launched");
        _openTrading();
    }
    function _openTrading() private {
        launched = true;
        ISolvexLaunchToken(address(svx)).openTradingFromLiquidity();
        (uint256 reserve,,) = _reserves();
        emit TradingOpened(reserve,totalUsdtAdded);
    }
    function setOperator(address operator, bool allowed) external onlyOwner {
        require(operator != address(0), "AutoLP: zero operator");
        operators[operator] = allowed;
        emit OperatorUpdated(operator,allowed);
    }
    function setLpRecipient(address recipient) external onlyOwner {
        require(recipient != address(0) && recipient != address(pair), "AutoLP: invalid recipient");
        lpRecipient = recipient;
        emit LpRecipientUpdated(recipient);
    }
    function setParams(uint256 slip, uint256 minU, uint256 minLp, uint256 bootstrap, uint256 seconds_) external onlyOwner {
        require(slip <= 500 && minU > 0 && minLp > 0 && bootstrap > 0 && seconds_ >= 30 && seconds_ <= 600, "AutoLP: invalid params");
        require(totalUsdtAdded == 0 || bootstrap == bootstrapSvxPerUsdt, "AutoLP: bootstrap already used");
        slippageBps = slip; minAddUsdt = minU; minLiquidity = minLp; bootstrapSvxPerUsdt = bootstrap; deadlineSeconds = seconds_;
        emit ParamsUpdated(slip,minU,minLp,bootstrap,seconds_);
    }
    function setPaused(bool state) external onlyOwner { paused=state; emit PausedStateChanged(state); }
    /// @notice No withdrawal of SVX inventory or pending USDT. LP remains owner-controlled.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(svx) && token != address(usdt) && to != address(0), "AutoLP: protected token/zero recipient");
        IERC20(token).safeTransfer(to,amount);
        emit TokenRescued(token,to,amount);
    }
    function emergencyWithdrawLp(address to,uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "AutoLP: zero recipient");
        IERC20(address(pair)).safeTransfer(to,amount);
        emit LpEmergencyWithdrawn(to,amount);
    }
    function rescueNative(address to,uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "AutoLP: zero recipient");
        (bool ok,) = payable(to).call{value:amount}(""); require(ok, "AutoLP: native transfer failed");
        emit NativeRescued(to,amount);
    }
    receive() external payable {}
}
