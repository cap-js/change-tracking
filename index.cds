using { managed, cuid } from '@sap/cds/common';

namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
aspect aspect @(UI.Facets: [{
  $Type : 'UI.ReferenceFacet',
  ID    : 'ChangeLogFacet',
  Label : '{i18n>ChangeLogList}',
  Target: 'changes/@UI.PresentationVariant#changelog'
}]) {
  changes : Association to many ChangeLog
              on changes.entityKey = ID;
  key ID  : UUID;
}

/**
 * Tracked (bulk) changes on draft are stored in ChangeLog
 */
@cds.autoexpose
entity ChangeEntry : managed, cuid {
  entityKey     :      UUID    @title     : '{i18n>ChangeLog.entityKey}';
  entityName    :      String  @title     : '{i18n>ChangeLog.entityName}';
  serviceEntity :      String  @title     : '{i18n>ChangeLog.serviceEntity}';
  changes       : many Changes @odata.Type: 'Edm.String';
  changelist    :      String  @title     : '{i18n>ChangeLog.changeList}';
}
@cds.autoexpose
entity ChangeLog as projection on ChangeEntry actions {
    action listChanges();
};

/**
 * Details for every tracked change from ChangeLog are stored
 * in Changes
 */
type Changes : {
  entityKey        : String @title: '{i18n>Changes.entityID}';
  keys             : String @title: '{i18n>Changes.keys}';
  attribute        : String @title: '{i18n>Changes.attribute}';
  valueChangedFrom : String @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedTo   : String @title: '{i18n>Changes.valueChangedTo}';
  modification     : String @title: '{i18n>Changes.modification}' enum {
    create = 'Create';
    update = 'Edit';
    delete = 'Delete';
  };
}

/**
 * UI representation of tracked changes
 */
annotate ChangeLog with @(UI: {
  PresentationVariant #changelog: {
    $Type         : 'UI.PresentationVariantType',
    Visualizations: ['@UI.LineItem#changelog'],
    SortOrder     : [{
      $Type     : 'Common.SortOrderType',
      Property  : createdAt,
      Descending: true,
    }],
    GroupBy       : [ID]
  },
  LineItem #changelog           : [
    {
      $Type: 'UI.DataField',
      Label: '{i18n>ChangeLog.ID}',
      Value: ID,
      ![@UI.Hidden]
    },
    {
      $Type: 'UI.DataField',
      Label: '{i18n>ChangeLog.entityName}',
      Value: entityName,
    },
    {
      $Type: 'UI.DataField',
      Value: createdAt
    },
    {
      $Type: 'UI.DataField',
      Value: createdBy
    },
    /** Workaround: We put our stringified changes in here, as putting it into
     * change directly will throw a runtime errors as type collection does not
     * match the return type string
     */
    {
      $Type: 'UI.DataField',
      Label: '{i18n>ChangeLog.changelist}',
      Value: changelist
    },
    /** Can we hide this (from UI only, as we still need to access its data)? */
    {
      $Type: 'UI.DataField',
      Label: '{i18n>ChangeLog.changes}',
      Value: changes
    },
    /** Want to disable an action button for 'expand/collaps' feature on changes */
    // {
    //   $Type: 'UI.DataFieldForAction',
    //   Action: 'sap.changelog.listChanges',
    //   Label: '{i18n>ChangeLog.changes}'
    // }
  ]
});