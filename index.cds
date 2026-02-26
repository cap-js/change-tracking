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
  @UI.PartOfPreview: false
}]) {
      changes : Association to many ChangeView
                  on  changes.entityKey     = ID and changes.entity        = 'ENTITY'
                  or  changes.rootEntityKey = ID and changes.rootEntity    = 'ROOTENTITY';
      key ID      : String;
}


// This is a helper view to flatten the assoc path to the entityKey
// Locale fallback: tries exact locale first (e.g., en_GB), then base locale (e.g., en)
@readonly
@cds.autoexpose
view ChangeView as select from Changes {
  *,
  ID @UI.Hidden,
  COALESCE(
      (
        select text from i18nKeys where ID = Changes.attribute and locale = $user.locale
      ),
      (
        select text from i18nKeys where ID = Changes.attribute and locale = substring($user.locale, 0, (case when indexof($user.locale, '_') >= 0 then indexof($user.locale, '_') else length($user.locale) end))
      ),
      Changes.attribute
    ) as attributeLabel: String(5000) @title: '{i18n>Changes.attribute}',
  COALESCE(
      (
        select text from i18nKeys where ID = Changes.entity and locale = $user.locale
      ),
      (
        select text from i18nKeys where ID = Changes.entity and locale = substring($user.locale, 0, (case when indexof($user.locale, '_') >= 0 then indexof($user.locale, '_') else length($user.locale) end))
      ),
      Changes.entity
    ) as entityLabel: String(5000) @title: '{i18n>Changes.entity}',
  COALESCE(
      (
        select text from i18nKeys where ID = Changes.modification and locale = $user.locale
      ),
      (
        select text from i18nKeys where ID = Changes.modification and locale = substring($user.locale, 0, (case when indexof($user.locale, '_') >= 0 then indexof($user.locale, '_') else length($user.locale) end))
      ),
      Changes.modification
    ) as modificationLabel: String(5000) @title: '{i18n>Changes.modification}',
  COALESCE(
      (
        select text from i18nKeys where ID = Changes.objectID and locale = $user.locale
      ),
      (
        select text from i18nKeys where ID = Changes.objectID and locale = substring($user.locale, 0, (case when indexof($user.locale, '_') >= 0 then indexof($user.locale, '_') else length($user.locale) end))
      ),
      Changes.objectID
    ) as objectID: String(5000) @title: '{i18n>Changes.objectID}',
  COALESCE(
      (
        select text from i18nKeys where ID = Changes.rootObjectID and locale = $user.locale
      ),
      (
        select text from i18nKeys where ID = Changes.rootObjectID and locale = substring($user.locale, 0, (case when indexof($user.locale, '_') >= 0 then indexof($user.locale, '_') else length($user.locale) end))
      ),
      Changes.rootObjectID
    ) as rootObjectID: String(5000) @title: '{i18n>Changes.rootObjectID}',
  COALESCE(Changes.valueChangedFromLabel, Changes.valueChangedFrom) as valueChangedFromLabel: String(5000) @title: '{i18n>Changes.valueChangedFrom}',
  COALESCE(Changes.valueChangedToLabel, Changes.valueChangedTo) as valueChangedToLabel: String(5000) @title: '{i18n>Changes.valueChangedTo}'
};

entity i18nKeys {
  key ID     : String(5000);
  key locale : String(100);
      text   : String(5000);
}

entity CHANGE_TRACKING_DUMMY {
  key X     : String(5);
}

entity Changes : cuid {
  attribute             : String(5000)      @title: '{i18n>Changes.attribute}';
  valueChangedFrom      : String(5000)      @title: '{i18n>Changes.valueChangedFrom}'  @UI.MultiLineText;
  valueChangedTo        : String(5000)      @title: '{i18n>Changes.valueChangedTo}'    @UI.MultiLineText;
  valueChangedFromLabel : String(5000)      @title: '{i18n>Changes.valueChangedFromLabel}';
  valueChangedToLabel   : String(5000)      @title: '{i18n>Changes.valueChangedToLabel}';

  entity                : String(5000)      @UI.Hidden; // target entity on db level
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
  HeaderInfo : {
      $Type : 'UI.HeaderInfoType',
      TypeName : '{i18n>ChangeHistory}',
      TypeNamePlural : '{i18n>ChangeHistory}',
  },
  LineItem           : [
    {
      Value             : modificationLabel,
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
      Value             : attributeLabel,
      @HTML5.CssDefaults: {width: '9%'}
    },
    {
      Value             : valueChangedToLabel,
      @HTML5.CssDefaults: {width: '11%'}
    },
    {
      Value             : valueChangedFromLabel,
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
