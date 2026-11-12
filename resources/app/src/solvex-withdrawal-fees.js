// USDT 提现与 SVX 提现采用同一口径：到账数量另加 2% 手续费，归入 LP。
// 记账口径（2026-11-10 改为按日批量）：
//   - 提现成功放款（status=paid）后，才把该笔手续费记入 LP 流水并累计到当日/币种池；
//   - 提现驳回/失败退款：若已累计则冲销扣减，不产生负累计；
//   - 每日 00:00（UTC+8）由 a-token-lp-job-service 合并成一个加池任务，减少 gas；
//   - 累计或任务异常只记录日志，绝不回滚或阻塞提现本身。
export function installSolvexWithdrawalFees({walletService,aTokenService,database,lpJobService=null}) {
  walletService.setWithdrawalFeePolicy({
    rateBps:200,
    transaction:aTokenService.transaction,
    record() {
      // 手续费在创建时已从余额扣除，但 LP 流水/累计改为放款成功后记账（见 paid）。
    },
    paid(record) {
      if(!lpJobService) return;
      try {
        lpJobService.accrueWithdrawalFee(record);
      } catch (error) {
        // 提现已成功，累计失败只告警；同一提现单重复触发幂等
        console.warn('提现成功后累计加池手续费失败（提现不受影响）:', error?.message || error);
      }
    },
    reverse(record) {
      try {
        const reversed = lpJobService?.reverseWithdrawalFee(record,'withdrawal_reversed');
        // 兼容旧数据：旧版本在提现创建时就写了 LP 流水，但没有 accrual 记录，仍需冲销流水。
        if(!reversed&&record.asset==='USDT'&&database.getATokenLpPoolEntryByRef('withdraw_fee','usdt:'+record.id)){
          database.insertATokenLpPoolEntryRow({id:'alp_usdt_refund_'+record.id,source:'withdraw_fee',refId:'usdt:'+record.id+':refund',wallet:record.wallet,asset:'USDT',usdtUnits:record.feeUnits,direction:'out',createdAt:Date.now(),payload:{withdrawalId:record.id}});
        }
      } catch (error) {
        // 冲销失败不能阻断提现退款；差额交给后台人工核对
        console.warn('提现冲销加池手续费失败（提现不受影响）:', error?.message || error);
      }
    },
  });
}
