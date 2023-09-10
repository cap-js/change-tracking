using { managed, cuid } from '@sap/cds/common';
namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
aspect aspect @(
  UI.Facets: [{
    $Type : 'UI.ReferenceFacet',
    ID    : 'ChangeLogFacet',
    Label : '{i18n>ChangeLogList}',
    Target: 'changes/@UI.PresentationVariant'
  }]
) {
  changes : Association to many ChangeLog on changes.entityKey = ID;
  key ID : UUID;
}


type Changes :  {
  // TODO: Which of these is the Business meaningful object id?
  entityKey         : String                   @title: '{i18n>Changes.entityID}';
  keys              : String                   @title: '{i18n>Changes.keys}';
  attribute         : String                   @title: '{i18n>Changes.attribute}';
  valueChangedFrom  : String                   @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedTo    : String                   @title: '{i18n>Changes.valueChangedTo}';
  entityName        : String                   @title: '{i18n>Changes.entity}';
  serviceEntity     : String                   @title: '{i18n>Changes.serviceEntity}';

  @title: '{i18n>Changes.modification}'
  modification      : String enum {
    create = 'Create';
    update = 'Edit';
    delete = 'Delete';
  };
}

//TODO: Move Business meaingful key to ChangeLog Table
@cds.autoexpose
entity ChangeLog : managed, cuid {
  entity        : String @title: '{i18n>ChangeLog.entity}';
  entityKey     : UUID   @title: '{i18n>ChangeLog.entityKey}';
  serviceEntity : String @title: '{i18n>ChangeLog.serviceEntity}';
  @cds.api.ignore
  changes       : many Changes;
  changeslist: Composition of many changeslist;
}

@cds.persistence.skip
entity changeslist: Changes {};

annotate ChangeLog with @(UI: {
  PresentationVariant: {
    Visualizations: ['@UI.LineItem'],
    RequestAtLeast: [
      entityKey,
      entity
    ],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
  },
  LineItem           : [
    { Value: entityKey },
    { Value: entity },
    { Value: createdBy },
    { Value: createdAt }
  ],
  DeleteHidden       : true,
});
