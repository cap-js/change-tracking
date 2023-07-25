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


entity Changes : managed {

  key ID            : UUID                    @UI.Hidden;
  keys              : String                   @title: '{i18n>Changes.keys}';
  attribute         : String                   @title: '{i18n>Changes.attribute}';
  valueChangedFrom  : String                   @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedTo    : String                   @title: '{i18n>Changes.valueChangedTo}';

  // Business meaningful object id
  entityID          : String                   @title: '{i18n>Changes.entityID}';
  entityKey         : UUID                     @title: '{i18n>Changes.entityKey}';
  entity            : String                   @title: '{i18n>Changes.entity}';
  serviceEntity     : String                   @title: '{i18n>Changes.serviceEntity}';

  objectID          : String                   @title: '{i18n>Changes.entityID}';
  parentObjectID    : String                   @title: '{i18n>Changes.parentEntityID}';

  // Business meaningful parent object id
  parentEntityID    : String                   @title: '{i18n>Changes.parentEntityID}';
  parentKey         : UUID                     @title: '{i18n>Changes.parentKey}';
  serviceEntityPath : String                   @title: '{i18n>Changes.serviceEntityPath}';

  @title: '{i18n>Changes.modification}'
  modification      : String enum {
    create = 'Create';
    update = 'Edit';
    delete = 'Delete';
  };

  valueDataType     : String                   @title: '{i18n>Changes.valueDataType}';
  changes           : Composition of Changes on changes.entityKey = entityKey;
}

annotate Changes with @(UI: {
  PresentationVariant: {
    Visualizations: ['@UI.LineItem'],
    RequestAtLeast: [
      parentKey,
      serviceEntity,
      serviceEntityPath
    ],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
  },
  LineItem           : [
    { Value: objectID },
    { Value: entity },
    { Value: parentObjectID },
    { Value: attribute },
    { Value: valueChangedTo },
    { Value: valueChangedFrom },
    { Value: createdBy },
    { Value: createdAt },
    { Value: modification }
  ],
  DeleteHidden       : true,
});
