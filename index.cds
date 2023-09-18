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
  changes : Association to many ChangeLog on changes.entityKey = ID;
  key ID : UUID;
}


type Changes : managed {

  ID                : UUID                    @UI.Hidden;
  keys              : String                   @title: '{i18n>Changes.keys}';
  attribute         : String                   @title: '{i18n>Changes.attribute}';
  valueChangedFrom  : String                   @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedTo    : String                   @title: '{i18n>Changes.valueChangedTo}';

  // Business meaningful object id
  entityID          : String                   @title: '{i18n>Changes.entityID}';
  entityKey         : String                   @title: '{i18n>Changes.entity}';
  serviceEntity     : String                   @title: '{i18n>Changes.serviceEntity}';

  // Business meaningful parent object id
  parentEntityID    : String                   @title: '{i18n>Changes.parentEntityID}';
  parentKey         : UUID                     @title: '{i18n>Changes.parentKey}';
  serviceEntityPath : String                   @UI.Hidden @title: '{i18n>Changes.serviceEntityPath}';

  @title: '{i18n>Changes.modification}'
  modification      : String enum {
    create = 'Create';
    update = 'Edit';
    delete = 'Delete';
  };

  valueDataType     : String                   @title: '{i18n>Changes.valueDataType}';
}

// REVISIT: Get rid of that
@cds.autoexpose
entity ChangeLog : managed, cuid {
  entityName    : String @title: '{i18n>ChangeLog.entity}';
  entityKey     : UUID   @title: '{i18n>ChangeLog.entityKey}';
  serviceEntity : String @title: '{i18n>ChangeLog.serviceEntity}';
  changes       : many Changes;
  virtual changelist: String;
}

annotate ChangeLog with @(UI: {
  PresentationVariant: {
    Visualizations: ['@UI.LineItem'],
    RequestAtLeast: [
      //parentKey,
      serviceEntity,
      //serviceEntityPath
    ],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
  },
  LineItem           : [
    //{ Value: objectID },
    { Value: entityName },
    //{ Value: parentObjectID },
    //{ Value: attribute },
    //{ Value: valueChangedTo },
    //{ Value: valueChangedFrom },
    { Value: createdBy },
    { Value: createdAt },
    //{ Value: modification },
    { Value: changelist, ![@UI.Importance]: #High }
  ],
  DeleteHidden       : true,
});
