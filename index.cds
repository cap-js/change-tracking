using { managed, cuid } from '@sap/cds/common';

namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
@cds.persistence.skip
entity aspect @(UI.Facets: [{
  $Type               : 'UI.ReferenceFacet',
  ID                  : 'ChangeHistoryFacet',
  Label               : '{i18n>ChangeHistory}',
  Target              : 'changes/@UI.PresentationVariant',
  ![@UI.PartOfPreview]: false
}]) {
      changes : Association to many ChangeView
                  on  changes.entityKey     = ID and changes.entity        = 'DUMMY'
                  or  changes.rootEntityKey = ID and changes.rootEntity    = 'DUMMY';
      key ID      : String;
}


// This is a helper view to flatten the assoc path to the entityKey
@readonly
@cds.autoexpose
view ChangeView as select from Changes {
  *,
  ID @UI.Hidden,
  COALESCE(
      (
        select text from i18nKeys where ID = Changes.attribute and locale = $user.locale
      ), Changes.attribute
    ) as attribute: String(5000) @title: '{i18n>Changes.attribute}',
  COALESCE(
      (
        select text from i18nKeys where ID = Changes.entity and locale = $user.locale
      ), Changes.entity
    ) as entityLabel: String(5000) @title: '{i18n>Changes.entity}',
    COALESCE(
      (
        select text from i18nKeys where ID = Changes.modification and locale = $user.locale
      ), Changes.modification
    ) as modification: String(5000) @title: '{i18n>Changes.modification}'
};

entity i18nKeys {
  key ID     : String(5000);
  key locale : String(10);
      text   : String(5000);
}

entity Changes : cuid {
  attribute        : String(5000)      @title: '{i18n>Changes.attribute}';
  valueChangedFrom : String(5000)      @title: '{i18n>Changes.valueChangedFrom}'  @UI.MultiLineText;
  valueChangedTo   : String(5000)      @title: '{i18n>Changes.valueChangedTo}'    @UI.MultiLineText;

  entity           : String(5000)      @UI.Hidden; // target entity on db level
  entityKey        : String(5000)      @title: '{i18n>Changes.entityKey}'; // primary key of target entity

  rootEntity       : String(5000)      @title: '{i18n>Changes.rootEntity}';
  rootEntityKey    : String(5000)      @title: '{i18n>Changes.rootKey}';

  // Business meaningful object id
  objectID         : String(5000)      @title: '{i18n>Changes.objectID}';
  rootObjectID   : String(5000)        @title: '{i18n>Changes.rootObjectID}';

  @title: '{i18n>Changes.modification}'
  modification     : String enum {
    Create = 'create';
    Update = 'update';
    Delete = 'delete';
  };

  valueDataType    : String(5000)      @title: '{i18n>Changes.valueDataType}'     @UI.Hidden;
  createdAt        : managed:createdAt @title: '{i18n>Changes.createdAt}';
  createdBy        : managed:createdBy @title: '{i18n>Changes.createdBy}';
  transactionID    : Int64             @title: '{i18n>Changes.transactionID}';
}

annotate ChangeView with @(UI: {
  PresentationVariant: {
    Visualizations: ['@UI.LineItem'],
    RequestAtLeast: [
      rootEntityKey,
      valueDataType
    ],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
  },
  LineItem           : [
    {
      Value             : modification,
      @HTML5.CssDefaults: {width: '9%'}
    },
    {
      Value             : createdAt,
      @HTML5.CssDefaults: {width: '12%'}
    },
    {
      Value             : createdBy,
      @HTML5.CssDefaults: {width: '9%'}
    },
    {
      Value             : entityLabel,
      @HTML5.CssDefaults: {width: '11%'}
    },
    {
      Value             : objectID,
      @HTML5.CssDefaults: {width: '14%'}
    },
    {
      Value             : attribute,
      @HTML5.CssDefaults: {width: '9%'}
    },
    {
      Value             : valueChangedTo,
      @HTML5.CssDefaults: {width: '11%'}
    },
    {
      Value             : valueChangedFrom,
      @HTML5.CssDefaults: {width: '11%'}
    },
    {
      Value             : rootObjectID,
      @HTML5.CssDefaults: {width: '14%'},
      ![@UI.Hidden]     : true
    }
  ],
  DeleteHidden       : true,
});
