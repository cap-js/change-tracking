using { managed, cuid } from '@sap/cds/common';
namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
aspect aspect @(
  UI.Facets: [{
    $Type : 'UI.ReferenceFacet',
    ID    : 'ChangeHistoryFacet',
    Label : '{i18n>ChangeHistoryList}',
    Target: 'changes/@UI.PresentationVariant'
  }]
) {
  changes : Association to many Changes on changes.entityKey = ID;
  key ID : UUID;
}

@readonly
@cds.autoexpose
entity Changes : cuid, managed {
  entityKey        : String @title: '{i18n>Changes.entityID}';
  entityName       : String @title: '{i18n>Changes.entity}';
  serviceEntity    : String @title: '{i18n>Changes.serviceEntity}';
  keys             : String @title: '{i18n>Changes.keys}';
  attribute        : String @title: '{i18n>Changes.attribute}';
  valueChangedFrom : String @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedTo   : String @title: '{i18n>Changes.valueChangedTo}';
  modification     : String @title: '{i18n>Changes.modification}'
  enum {
    create = 'Create';
    update = 'Edit';
    delete = 'Delete';
  };
  parent            : Association to Changes;
  children          : Composition of many Changes on children.parent = $self;

  hierarchyLevel    : Integer default 0;
  drillState        : String default 'expanded';
};

annotate Changes with @(UI: {
  PresentationVariant: {
    Visualizations: ['@UI.LineItem'],
    RequestAtLeast: [entityKey],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    },
    {
      Property  : hierarchyLevel,
      Descending: false
    }]
  },
  LineItem: [
    {
      $Type : 'UI.DataField',
      Value: hierarchyLevel
    },
    {
      $Type : 'UI.DataField',
      Value: createdAt
    },
    {
      $Type : 'UI.DataField',
      Value: createdBy
    },
    {
      $Type : 'UI.DataField',
      Value: entityName,
      Label: '{i18n>Changes.entity}'
    },
    {
       $Type : 'UI.DataField',
       Value: valueChangedFrom,
       Label: '{i18n>Changes.valueChangedFrom}'
    },
    {
      $Type : 'UI.DataField',
      Value: valueChangedTo,
      Label: '{i18n>Changes.valueChangedTo}'
    },
    {
      $Type : 'UI.DataField',
      Value: attribute,
      Label: '{i18n>Changes.attribute}'
    },
    {
      $Type : 'UI.DataField',
      Value: modification,
      Label: '{i18n>Changes.modification}'
    }
  ]
});
