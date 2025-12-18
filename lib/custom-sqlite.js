const cds = require('@sap/cds')
const SQLiteService = require('@cap-js/sqlite')

module.exports = class CustomSQLiteService extends SQLiteService {
  get factory() {
    const base = super.factory
    return {
      ...base,
      create: tenant => {
        const dbc = base.create(tenant)
        const deterministic = { deterministic: true }
        dbc.function('uuid', deterministic, () => cds.utils.uuid())
        return dbc
      }
    }
  }
}