using { managed, cuid } from '@sap/cds/common';

namespace sap.changelog;

/**
 * Tracks changes events on @changelog annotated entities
 */
@readonly
@cds.autoexpose
entity ChangeLog : managed, cuid {
  entityKey     :      UUID    @title     : '{i18n>ChangeLog.entityKey}';
  entityName    :      String  @title     : '{i18n>ChangeLog.entityName}';
  serviceEntity :      String  @title     : '{i18n>ChangeLog.serviceEntity}';
  changes       : many Changes @odata.Type: 'Edm.String';
  changelist    :      String  @title     : '{i18n>ChangeLog.changeList}';
}

/**
 * Contains details on every tracked change
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
 * Used in UI representation of tracked changes
 */
annotate ChangeLog with @(UI: {
  PresentationVariant #changelog: {
    $Type         : 'UI.PresentationVariantType',
    Visualizations: ['@UI.LineItem#changelog'],
    SortOrder     : [{
      $Type     : 'Common.SortOrderType',
      Property  : createdAt,
      Descending: true,
    }]
  },
  LineItem #changelog           : [
    {
      $Type: 'UI.DataField',
      Value: createdAt,
    },
    {
      $Type: 'UI.DataField',
      Value: createdBy,
    },
    {
      $Type: 'UI.DataField',
      Label: 'ID',
      Value: ID
    },
    {
      $Type: 'UI.DataField',
      Label: '{i18n>ChangeLog.entityKey}',
      Value: entityKey,
    },
    {
      $Type: 'UI.DataField',
      Label: '{i18n>ChangeLog.entityName}',
      Value: entityName,
    },
    /** Can we also use a url from the service here? */
      //Url: `#/{path}(ID={entityKey},IsActiveEntity=true)?$select={entityKey}`,
    {
      $Type  : 'UI.DataFieldWithUrl',
      Label: 'Changes',
      Value  : 'View Changes',
      Url: '/changelist?ID={ID}&entityKey={entityKey}'
    },
    {
      $Type: 'UI.DataField',
      Label: '{i18n>ChangeLog.changelist}',
      Value: changelist,
    }
  ]
});
