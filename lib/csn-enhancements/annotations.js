const cds = require('@sap/cds');
const LOG = cds.log('change-tracking');
const DEBUG = cds.debug('change-tracking');

/**
 * Add side effects annotations for actions to refresh the changes association.
 */
function addSideEffects(actions, entityName, hierarchyMap, model) {
  const isRootEntity = !hierarchyMap.has(entityName);

  if (isRootEntity) {
    for (const se of Object.values(actions)) {
      const attr = se['@Common.SideEffects.TargetProperties'];
      if (attr?.length >= 0) {
        if (!attr.includes('changes')) attr.push('changes');
      } else {
        se['@Common.SideEffects.TargetProperties'] = ['changes'];
      }
    }
  } else {
    const parentAssociationName = _findParentAssociation(entityName, hierarchyMap, model);
    const property = { '=': `${parentAssociationName}.changes` };

    for (const se of Object.values(actions)) {
      const attr = se['@Common.SideEffects.TargetEntities'];
      if (attr?.length >= 0) {
        if (!attr.some((item) => item['='] === property['='])) attr.push(property);
      } else {
        se['@Common.SideEffects.TargetEntities'] = [property];
      }
    }
  }
}

function _findParentAssociation(entityName, hierarchyMap, model) {
  const parentEntityName = hierarchyMap.get(entityName);
  const parentEntity = model.definitions[parentEntityName];
  if (parentEntity?.elements) {
    for (const [elemName, elem] of Object.entries(parentEntity.elements)) {
      if (elem.type === 'cds.Composition' && elem.target === entityName) return elemName;
    }
  }
  return null;
}

function addUIFacet(entity, m) {
  const { 'sap.changelog.aspect': aspect } = m.definitions;
  const {
    '@UI.Facets': [facet]
  } = aspect;
  if (entity['@changelog.disable_facet'] !== undefined) {
    LOG.warn(
      `@changelog.disable_facet is deprecated! You can just define your own Facet for the changes association or annotate the changes association on ${entity.name} with not readable via @Capabilities.NavigationRestrictions.RestrictedProperties`
    );
  }

  let facets = entity['@UI.Facets'];

  if (!facets) {
    DEBUG?.(`${entity.name} does not have a @UI.Facets annotation and thus the change tracking section is not added.`);
  }
  // Add UI.Facet for Change History List
  if (
    facets &&
    !entity['@changelog.disable_facet'] &&
    !hasFacetForComp('changes', entity['@UI.Facets']) &&
    !entity['@Capabilities.NavigationRestrictions.RestrictedProperties']?.some((restriction) => restriction.NavigationProperty?.['='] === 'changes' && restriction.ReadRestrictions?.Readable === false)
  ) {
    // UI.Hidden is only for ensuring changes are not shown in draft
    // When draft is not given, this would cause a compiler crash
    // Clone the facet so the shared template is never mutated
    const entityFacet = { ...facet };
    if (!entity['@odata.draft.enabled']) {
      delete entityFacet['@UI.Hidden'];
    }
    facets.push(entityFacet);
  }
}

/**
 * Check if a facet already exists for the changes composition.
 */
function hasFacetForComp(compName, facets) {
  return facets.some((f) => (f.Target && f.Target.startsWith(`${compName}/`)) || (f.Facets && hasFacetForComp(compName, f.Facets)));
}

module.exports = {
  addSideEffects,
  addUIFacet
};
