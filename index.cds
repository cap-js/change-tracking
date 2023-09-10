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
  changes : Association to many ChangeView on changes.entityKey = ID;
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
  entity            : String                   @title: '{i18n>Changes.entity}';
  serviceEntity     : String                   @title: '{i18n>Changes.serviceEntity}';

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
  changeLog         : Association to ChangeLog @title: '{i18n>ChangeLog.ID}';
}

// REVISIT: Get rid of that
entity ChangeLog : managed, cuid {
  entity        : String @title: '{i18n>ChangeLog.entity}';
  entityKey     : UUID   @title: '{i18n>ChangeLog.entityKey}';
  serviceEntity : String @title: '{i18n>ChangeLog.serviceEntity}';
  changes       : Composition of many Changes on changes.changeLog = $self;
}

// REVISIT: Get rid of that
view ChangeView as
  select from Changes {
    ID                  as ID                @UI.Hidden,
    attribute           as attribute,
    entityID            as objectID,
    entity              as entity,
    serviceEntity       as serviceEntity,
    parentEntityID      as parentObjectID,
    parentKey           as parentKey,
    valueChangedFrom    as valueChangedFrom,
    valueChangedTo      as valueChangedTo,
    modification        as modification,
    createdBy           as createdBy,
    createdAt           as createdAt,
    changeLog.entityKey as entityKey,
    serviceEntityPath   as serviceEntityPath @UI.Hidden,
  };


annotate ChangeView with @(UI: {
  PresentationVariant: {
    Visualizations: [ '@UI.LineItem' ],
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
    { Value: entity },
    { Value: attribute },
    { Value: valueChangedTo },
    { Value: valueChangedFrom },
    { Value: createdBy },
    { Value: createdAt },
    { Value: modification }
  ],
  DeleteHidden       : true,
});