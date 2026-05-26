const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const { entityKeyExpr: entityKeyExprSqlite } = require('../sqlite/sql-expressions');
const { entityKeyExpr: entityKeyExprHANA } = require('../hana/sql-expressions');
const { entityKeyExpr: entityKeyExprPG } = require('../postgres/sql-expressions');
const { isChangeTracked, getBaseEntity, normalizeAnnotationRefs, getDbElementName } = require('../utils/entity-collector');

function _buildTimezoneValue(annotation, dbEntityName) {
  if (annotation?.['=']) {
    // build a sub-SELECT against the DB entity for dynamic timezone
    return SELECT.from(dbEntityName).alias('timezoneSubSelect').where('1 = 1').columns(annotation['=']);
  }
  return annotation;
}

function collectTrackedPropertiesWithTimezone(m) {
  // Map keyed by "dbEntityName::dbElementName" → { property, entity, timezone }
  const collected = new Map();

  for (const name in m.definitions) {
    const entity = m.definitions[name];
    if (entity.kind !== 'entity' || !isChangeTracked(entity)) continue;

    // Resolve DB entity (self for DB entities, base for projections/views)
    const isServiceEntity = !!(entity.query || entity.projection);
    let dbEntityName, dbEntity;
    if (isServiceEntity) {
      const baseInfo = getBaseEntity(entity, m);
      if (!baseInfo) {
        LOG.debug(`Tracked Timezone Properties: DB Entity for ${name} not found!`);
        continue;
      }
      dbEntityName = baseInfo.baseRef;
      dbEntity = baseInfo.baseEntity;
    } else {
      dbEntityName = name;
      dbEntity = entity;
    }

    for (const ele in entity.elements) {
      const element = entity.elements[ele];
      if (!element['@Common.Timezone'] || element._foreignKey4) continue;

      // For service entities, map service element name to DB element name (handles renaming/flattening)
      const dbElemName = isServiceEntity ? getDbElementName(entity, ele, m) : ele;

      // Skip if the DB element doesn't exist (e.g. computed/virtual service columns)
      if (!dbEntity.elements[dbElemName]) continue;

      const key = `${dbEntityName}::${dbElemName}`;
      if (collected.has(key)) continue;

      // REVISIT: maybe use additional CSN next to runtimeCSN which hasn't resolved annotations already
      // For service entities, normalize annotation refs back to DB-level (handles renamed columns in dynamic timezone path)
      const annotation = isServiceEntity ? normalizeAnnotationRefs(element['@Common.Timezone'], entity, m) : element['@Common.Timezone'];

      collected.set(key, {
        property: dbElemName,
        entity: dbEntityName,
        timezone: _buildTimezoneValue(annotation, dbEntityName)
      });
    }
  }

  return [...collected.values()];
}

function isDeploy2Check(target) {
  try {
    cds.build?.register(target, class ABC extends cds.build.Plugin {});
  } catch (err) {
    if (err.message.match(/already registered/)) {
      return true;
    }
  }
  return false;
}

function enhanceChangeViewWithTimeZones(changeView, m) {
  const entityKeyExpr =
    isDeploy2Check('hana') && m.meta.creator.match(/v6/)
      ? entityKeyExprHANA
      : isDeploy2Check('postgres') && m.meta.creator.match(/v6/)
        ? entityKeyExprPG
        : cds.env.requires?.db?.kind === 'sqlite' && !cds.build
          ? entityKeyExprSqlite
          : cds.env.requires?.db?.kind === 'postgres' && (!cds.build || cds.env.profiles.includes('pg'))
            ? entityKeyExprPG
            : entityKeyExprHANA;
  const timezoneProperties = collectTrackedPropertiesWithTimezone(m);
  const timezoneColumn = changeView.query.SELECT.columns.find((c) => c.as && c.as === 'valueTimeZone');
  if (timezoneProperties.length === 0) return;
  delete timezoneColumn.val;
  timezoneColumn.xpr = ['case'];
  for (const timezoneProp of timezoneProperties) {
    timezoneColumn.xpr.push('when', { ref: ['attribute'] }, '=', { val: timezoneProp.property }, 'and', { ref: ['entity'] }, '=', { val: timezoneProp.entity }, 'then');
    if (timezoneProp.timezone.SELECT) {
      const subSelect = structuredClone(timezoneProp.timezone);
      const elements = m.definitions[timezoneProp.entity].elements;
      const keys = Object.keys(elements)
        .filter((e) => elements[e].key)
        .flatMap((k) => (elements[k].keys ? elements[k].keys.map((fk) => `${k}_${fk.ref[0]}`) : [k]));
      subSelect.SELECT.where = [
        { ref: ['change', 'entityKey'] },
        '=',
        // REVISIT: once HIERARCHY_COMPOSITE_ID is available on all DBs, use native CQN
        entityKeyExpr(keys)
      ];
      timezoneColumn.xpr.push(subSelect);
    } else {
      timezoneColumn.xpr.push({ val: timezoneProp.timezone });
    }
  }
  timezoneColumn.xpr.push('else', { val: null }, 'end');
}

module.exports = {
  collectTrackedPropertiesWithTimezone,
  enhanceChangeViewWithTimeZones
};
