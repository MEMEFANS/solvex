// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISolvexLaunchLiquidity {
    function liquidityReady() external view returns (bool);
}

/**
 * @title SolvexToken (SVX) — BSC 平台币，买入 0、卖出 5% 手续费
 *
 * 经济模型对应关系：
 *   - 固定总量 10 亿枚（1e9 * 1e18），部署时一次性铸给 initialOwner，且**不提供任何 mint 函数**；
 *   - PancakeSwap 交易对上的买入不收税（buyTaxBps 默认 0）、卖出扣 5%（sellTaxBps 默认 500）；
 *   - 手续费拆分：burnShareBps（默认 5000 = 50%）销毁，剩余 50% 转入 dividendWallet；
 *     两个比例与分红地址均可由 owner 调整；
 *   - 销毁方式二选一：默认转入 0x…dEaD（链上可见、不可恢复），也可切换为合约内 _burn；
 *   - 转账、钱包间互转不收税；仅「交易对 ↔ 用户」方向收税；
 *   - Router / 合约自身 / owner（用于建池、撤池、运营转账）默认免手续费；
 *   - 单笔上限、钱包上限默认关闭（值为 0），需要时由 owner 通过 setLimits 开启；
 *   - tradingEnabled 为可选的防机器人开关：默认关闭，只有豁免地址可转账；
 *     建池完成后调用 setTradingEnabled(true) 开放交易；
 *   - 合约没有增发入口、没有转账循环、没有外部回调；重入防护用于 rescue 类外部调用。
 */
contract SolvexToken is ERC20, ERC20Burnable, ERC20Permit, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ── 可配置项 ────────────────────────────────────────────────────────────
    address public router;
    address public dividendWallet;
    address public burnWallet;
    uint256 public buyTaxBps;
    uint256 public sellTaxBps;
    uint256 public burnShareBps;   // 手续费中销毁的占比，其余进分红钱包
    uint256 public maxTxAmount;    // 0 = 不限制（代币最小单位）
    uint256 public maxWalletAmount;// 0 = 不限制（代币最小单位）
    bool public feeEnabled;
    bool public tradingEnabled;
    bool public burnToDead;
    bool public antiBotEnabled;    // 预留开关：关闭后 tradingEnabled 不再拦截普通转账
    address public immutable launchController;
    event LaunchControllerSet(address indexed controller);

    mapping(address => bool) public isExempt;      // 手续费 + 限额豁免
    mapping(address => bool) public isAMMPair;     // 交易对（买入/卖出识别）

    event FeeApplied(
        address indexed from,
        address indexed to,
        uint256 netAmount,
        uint256 feeAmount,
        uint256 burnAmount,
        uint256 dividendAmount
    );
    event PairUpdated(address indexed pair, bool enabled);
    event RouterUpdated(address indexed router);
    event DividendWalletUpdated(address indexed wallet);
    event BurnWalletUpdated(address indexed wallet);
    event TaxRatesUpdated(uint256 buyTaxBps, uint256 sellTaxBps, uint256 burnShareBps);
    event FeeEnabledUpdated(bool enabled);
    event LimitsUpdated(uint256 maxTxAmount, uint256 maxWalletAmount);
    event ExemptionUpdated(address indexed account, bool exempt);
    event TradingEnabledUpdated(bool enabled);
    event AntiBotEnabledUpdated(bool enabled);
    event BurnModeUpdated(bool burnToDead);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    event NativeRescued(address indexed to, uint256 amount);

    /**
     * @param initialOwner      Owner + 全量 10 亿代币接收地址（默认可为多签/冷钱包）
     * @param dividendWallet_   手续费 50% 的分红收款地址
     * @param burnWallet_       销毁收款地址（burnToDead=true 时使用，通常 0x…dEaD）
     * @param router_           PancakeSwap V2 Router（如 0x10ED43C718714eb63d5aA57B78B54704E256024E）
     * @param pair_             SVX/USDT 交易对；可传 0，部署后通过 setPair 设置
     * @param launchController_ 固定开盘控制器地址（部署后不可替换）
     */
    constructor(
        address initialOwner,
        address dividendWallet_,
        address burnWallet_,
        address router_,
        address pair_,
        address launchController_
    ) ERC20("Solvex", "SVX") ERC20Permit("Solvex") Ownable(initialOwner) {
        require(initialOwner != address(0), "SolvexToken: owner zero");
        require(dividendWallet_ != address(0), "SolvexToken: dividend zero");
        require(burnWallet_ != address(0), "SolvexToken: burn zero");
        require(router_ != address(0), "SolvexToken: router zero");
        require(launchController_ != address(0), "SolvexToken: controller zero");

        dividendWallet = dividendWallet_;
        burnWallet = burnWallet_;
        router = router_;
        launchController = launchController_;
        burnToDead = true;
        antiBotEnabled = true;
        feeEnabled = true;
        tradingEnabled = false;
        buyTaxBps = 0;      // 买入 0 手续费（与内盘买入费一致）
        sellTaxBps = 500;   // 卖出 5%
        burnShareBps = 5_000;

        // Router / 合约自身 / Owner 默认豁免：建池、撤池、运营转账不产生税
        isExempt[address(this)] = true;
        isExempt[router_] = true;
        isExempt[initialOwner] = true;

        if (pair_ != address(0)) {
            isAMMPair[pair_] = true;
            emit PairUpdated(pair_, true);
        }

        _mint(initialOwner, MAX_SUPPLY);
    }

    // ── 转账主逻辑 ──────────────────────────────────────────────────────────
    function _update(address from, address to, uint256 value) internal override {
        // mint / burn 不走税，也不做限额（本合约无 mint 入口，burn 由用户主动触发）
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }

        if (antiBotEnabled && !tradingEnabled) {
            require(isExempt[from] || isExempt[to], "SolvexToken: trading disabled");
        }

        uint256 fee = _calculateFee(from, to, value);
        if (fee > 0) {
            uint256 burnAmount;
            uint256 dividendAmount;
            (burnAmount, dividendAmount) = _splitFee(fee);
            super._update(from, address(this), fee);
            _distributeFee(burnAmount, dividendAmount);
            super._update(from, to, value - fee);
            emit FeeApplied(from, to, value - fee, fee, burnAmount, dividendAmount);
        } else {
            super._update(from, to, value);
        }

        _enforceLimits(from, to, value);
    }

    function _calculateFee(address from, address to, uint256 value) private view returns (uint256) {
        if (!feeEnabled) return 0;
        if (isExempt[from] || isExempt[to]) return 0;
        if (isAMMPair[from]) return (value * buyTaxBps) / 10_000;  // 买入
        if (isAMMPair[to]) return (value * sellTaxBps) / 10_000;   // 卖出
        return 0;
    }

    function _splitFee(uint256 fee) private view returns (uint256 burnAmount, uint256 dividendAmount) {
        burnAmount = (fee * burnShareBps) / 10_000;
        dividendAmount = fee - burnAmount;
    }

    /// @dev 只做直接的 transfer / burn，没有外部调用循环，也没有回调。
    function _distributeFee(uint256 burnAmount, uint256 dividendAmount) private {
        if (burnAmount > 0) {
            if (burnToDead) {
                super._update(address(this), burnWallet, burnAmount);
            } else {
                _burn(address(this), burnAmount);
            }
        }
        if (dividendAmount > 0 && dividendWallet != address(this)) {
            super._update(address(this), dividendWallet, dividendAmount);
        }
    }

    function _enforceLimits(address from, address to, uint256 value) private view {
        if (isExempt[from] || isExempt[to]) return;
        if (maxTxAmount > 0) {
            require(value <= maxTxAmount, "SolvexToken: max tx exceeded");
        }
        if (maxWalletAmount > 0 && !isAMMPair[to]) {
            require(balanceOf(to) <= maxWalletAmount, "SolvexToken: max wallet exceeded");
        }
    }

    // ── Owner 配置 ──────────────────────────────────────────────────────────
    function setRouter(address router_) external onlyOwner {
        require(router_ != address(0), "SolvexToken: router zero");
        isExempt[router_] = true;
        router = router_;
        emit RouterUpdated(router_);
    }

    function setPair(address pair_, bool enabled) external onlyOwner {
        require(pair_ != address(0), "SolvexToken: pair zero");
        isAMMPair[pair_] = enabled;
        emit PairUpdated(pair_, enabled);
    }

    function setDividendWallet(address wallet) external onlyOwner {
        require(wallet != address(0), "SolvexToken: dividend zero");
        dividendWallet = wallet;
        emit DividendWalletUpdated(wallet);
    }

    function setBurnWallet(address wallet) external onlyOwner {
        require(wallet != address(0), "SolvexToken: burn zero");
        burnWallet = wallet;
        emit BurnWalletUpdated(wallet);
    }

    /**
     * @param buyTaxBps_      买入税率，<= 2000（20%）
     * @param sellTaxBps_     卖出税率，<= 2000（20%）
     * @param burnShareBps_   手续费中销毁占比，<= 10000；其余进分红钱包
     */
    function setTaxRates(uint256 buyTaxBps_, uint256 sellTaxBps_, uint256 burnShareBps_) external onlyOwner {
        require(buyTaxBps_ == 0 && sellTaxBps_ == 500, "SolvexToken: fixed tax 0/500");
        require(burnShareBps_ <= 10_000, "SolvexToken: burn share invalid");
        buyTaxBps = buyTaxBps_;
        sellTaxBps = sellTaxBps_;
        burnShareBps = burnShareBps_;
        emit TaxRatesUpdated(buyTaxBps_, sellTaxBps_, burnShareBps_);
    }

    function setFeeEnabled(bool enabled) external onlyOwner {
        require(enabled, "SolvexToken: fees mandatory");
        feeEnabled = enabled;
        emit FeeEnabledUpdated(enabled);
    }

    /// @notice 0 表示关闭限额；建议 maxTx <= maxWallet，且都按代币最小单位传入。
    function setLimits(uint256 maxTxAmount_, uint256 maxWalletAmount_) external onlyOwner {
        maxTxAmount = maxTxAmount_;
        maxWalletAmount = maxWalletAmount_;
        emit LimitsUpdated(maxTxAmount_, maxWalletAmount_);
    }

    function setExempt(address account, bool exempt) external onlyOwner {
        require(account != address(0), "SolvexToken: account zero");
        isExempt[account] = exempt;
        emit ExemptionUpdated(account, exempt);
    }

    function setTradingEnabled(bool enabled) external onlyOwner {
        if (enabled) _requireLiquidityReady();
        tradingEnabled = enabled;
        emit TradingEnabledUpdated(enabled);
    }

    function setAntiBotEnabled(bool enabled) external onlyOwner {
        if (!enabled) _requireLiquidityReady();
        antiBotEnabled = enabled;
        emit AntiBotEnabledUpdated(enabled);
    }

    function setBurnToDead(bool enabled) external onlyOwner {
        burnToDead = enabled;
        emit BurnModeUpdated(enabled);
    }

    /// @notice Bind once, before opening. The controller checks real pair reserves.
    function openTradingFromLiquidity() external {
        require(msg.sender == launchController, "SolvexToken: not controller");
        _requireLiquidityReady();
        tradingEnabled = true;
        emit TradingEnabledUpdated(true);
    }

    function _requireLiquidityReady() private view {
        require(launchController != address(0), "SolvexToken: controller not set");
        require(ISolvexLaunchLiquidity(launchController).liquidityReady(), "SolvexToken: liquidity below threshold");
    }

    // ── 紧急提取（不影响代币经济）────────────────────────────────────────────
    /// @notice 只允许提取误转到本合约的其他 ERC20 / BNB，不能提取 SVX 本身。
    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0) && to != address(0), "SolvexToken: zero address");
        require(token != address(this), "SolvexToken: cannot rescue SVX");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    function rescueNative(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "SolvexToken: zero recipient");
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "SolvexToken: native transfer failed");
        emit NativeRescued(to, amount);
    }

    receive() external payable {}
}
