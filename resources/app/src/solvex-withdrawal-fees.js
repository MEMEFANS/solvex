// USDT / SVX 提现统一收取 2% 手续费（2026-11-12 口径）：
//   - 手续费在创建提现时从用户余额直接扣除；
//   - 放款成功（status=paid）后，手续费自动累计到平台后台（做市储备账户），不再进入 LP；
//   - 提现驳回/失败退款：冲销已累计的平台手续费；
//   - 记账异常只告警，绝不回滚或阻塞提现本身。
export function installSolvexWithdrawalFees({walletService,aTokenService}) {
  walletService.setWithdrawalFeePolicy({
    rateBps:200,
    transaction:aTokenService.transaction,
    record() {
      // 手续费在创建时已从余额扣除，等放款成功后再累计到后台。
    },
    paid(record) {
      try {
        const units = BigInt(record?.feeUnits || '0');
        if (units > 0n) aTokenService.moveTreasuryUsdt(units);
      } catch (error) {
        // 提现已成功，累计失败只告警；同一提现单重复触发不影响账务
        console.warn('提现手续费累计到后台失败（提现不受影响）:', error?.message || error);
      }
    },
    reverse(record) {
      try {
        const units = BigInt(record?.feeUnits || '0');
        if (units > 0n) aTokenService.moveTreasuryUsdt(-units);
      } catch (error) {
        // 冲销失败不能阻断提现退款；差额交给后台人工核对
        console.warn('提现手续费冲销失败（提现不受影响）:', error?.message || error);
      }
    },
  });
}
