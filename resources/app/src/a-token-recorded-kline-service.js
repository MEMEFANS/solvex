// Read recorded market data without generating prices, volumes or historical candles.
// A fresh database remains empty until an actual market-data source writes candles.
const PERIODS = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function createATokenRecordedKlineService({ database }) {
  return {
    readOnly: true,
    listKlines(period, limit = 500) {
      const selectedPeriod = PERIODS.includes(period) ? period : '15m';
      return database.listATokenKlines(selectedPeriod, limit);
    },
    status() {
      return {
        source: 'recorded',
        generationEnabled: false,
        settings: { mode: 'recorded' },
        periods: Object.fromEntries(PERIODS.map(period => [period, { count: database.countATokenKlines(period) }])),
      };
    },
  };
}
