using { managed, cuid } from '@sap/cds/common';
namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
@cds.persistence.skip entity aspect @(UI.Facets: [{
  $Type : 'UI.ReferenceFacet',
  ID    : 'ChangeHistoryFacet',
  Label : '{i18n>ChangeHistory}',
  Target: 'changes/@UI.PresentationVariant',
  ![@UI.PartOfPreview]: false
}]) {
  // Essentially: Association to many Changes on changes.changeLog.entityKey = ID;
  changes : Association to many ChangeView on changes.entityKey = ID OR changes.parentObjectID = ID;
  key ID  : UUID;
}


// This is a helper view to flatten the assoc path to the entityKey
@readonly
view ChangeView as
  select from Changes {
    *,
    entityID            as objectID, // no clue why we have to rename this?
    parentEntityID      as parentObjectID, // no clue why we have to rename this?
    changeLog.entityKey as entityKey, // flattening assoc path -> this is the main reason for having this helper view
    changeLog.createdAt as createdAt,
    changeLog.createdBy as createdBy,
  }
  excluding {
    entityID,
    parentEntityID,
  };

/**
 * Top-level changes entity, e.g. UPDATE Incident by, at, ...
 */
entity ChangeLog : cuid {
  serviceEntity : String(5000) @title: '{i18n>ChangeLog.serviceEntity}'; // definition name of target entity (on service level) - e.g. ProcessorsService.Incidents
  entity        : String(5000) @title: '{i18n>ChangeLog.entity}'; // definition name of target entity (on db level) - e.g. sap.capire.incidents.Incidents
  entityKey     : UUID   @title: '{i18n>ChangeLog.entityKey}'; // primary key of target entity, e.g. Incidents.ID
  createdAt     : managed:createdAt;
  createdBy     : managed:createdBy;
  changes       : Composition of many Changes on changes.changeLog = $self;
}

/**
 * Attribute-level Changes with simple capturing of one-level
 * composition trees in parent... elements.
 */
entity Changes {
  key ID                : UUID                     @UI.Hidden;
      keys              : String(5000)             @title: '{i18n>Changes.keys}';
      attribute         : String(5000)             @title: '{i18n>Changes.attribute}';
      valueChangedFrom  : String(5000)             @title: '{i18n>Changes.valueChangedFrom}' @UI.MultiLineText;
      valueChangedTo    : String(5000)             @title: '{i18n>Changes.valueChangedTo}' @UI.MultiLineText;

      // Business meaningful object id
      entityID          : String(5000)             @title: '{i18n>Changes.entityID}';
      entity            : String(5000)             @title: '{i18n>Changes.entity}'; // similar to ChangeLog.entity, but could be nested entity in a composition tree
      serviceEntity     : String(5000)             @title: '{i18n>Changes.serviceEntity}'; // similar to ChangeLog.serviceEntity, but could be nested entity in a composition tree

      // Business meaningful parent object id
      parentEntityID    : String(5000)             @title: '{i18n>Changes.parentEntityID}';
      parentKey         : UUID                     @title: '{i18n>Changes.parentKey}';

      @title: '{i18n>Changes.modification}'
      modification      : String enum {
        Create = 'create';
        Update = 'update';
        Delete = 'delete';
      };

      valueDataType     : String(5000)             @title: '{i18n>Changes.valueDataType}';
      changeLog         : Association to ChangeLog @title: '{i18n>ChangeLog.ID}' @UI.Hidden;
}

annotate ChangeView with @(UI: {
  PresentationVariant: {
    Visualizations: ['@UI.LineItem'],
    RequestAtLeast: [
      parentKey,
      serviceEntity
    ],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
  },
  LineItem           : [
    { Value: modification, @HTML5.CssDefaults: {width:'9%'} },
    { Value: createdAt, @HTML5.CssDefaults: {width:'12%'} },
    { Value: createdBy, @HTML5.CssDefaults: {width:'9%'} },
    { Value: entity, @HTML5.CssDefaults: {width:'11%'} },
    { Value: objectID, @HTML5.CssDefaults: {width:'14%'} },
    { Value: attribute, @HTML5.CssDefaults: {width:'9%'} },
    { Value: valueChangedTo, @HTML5.CssDefaults: {width:'11%'} },
    { Value: valueChangedFrom, @HTML5.CssDefaults: {width:'11%'} },
    { Value: parentObjectID, @HTML5.CssDefaults: {width:'14%'}, ![@UI.Hidden]: true }
  ],
  DeleteHidden       : true,
});
