using {
  managed,
  cuid
} from '@sap/cds/common';

namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
@cds.persistence.skip
entity aspect @(UI.Facets: [{
  $Type            : 'UI.ReferenceFacet',
  ID               : 'ChangeHistoryFacet',
  Label            : '{i18n>ChangeHistory}',
  Target           : 'changes/@UI.PresentationVariant',
  @UI.PartOfPreview: false
}]) {
      changes : Association to many ChangeView
                  on  changes.entityKey     = ID
                  and changes.entity        = 'ENTITY';
  key ID      : String;
}


// This is a helper view to flatten the assoc path to the entityKey
// Locale fallback: tries exact locale first (e.g., en_GB), then falls back to 'en'
// REVISIT: When dropping CDS 8 support, use base locale extraction instead of hardcoded 'en' fallback:
//   substring($user.locale, 0, (case when indexof($user.locale, '_') >= 0 then indexof($user.locale, '_') else length($user.locale) end))
//   This would extract 'en' from 'en_GB', 'de' from 'de_DE', etc. (indexof was introduced in CDS 9)
@readonly
@cds.autoexpose
view ChangeView as
  select from Changes as change {
    key change.ID                                        @UI.Hidden,
    *,
    COALESCE(
      (
        select text from i18nKeys
        where
              ID     = change.attribute
          and locale = $user.locale
      ), (
        select text from i18nKeys
        where
              ID     = change.attribute
          and locale = 'en'
      ), change.attribute
    ) as attributeLabel        : String(15) @title: '{i18n>Changes.attribute}',
    COALESCE(
      (
        select text from i18nKeys
        where
              ID     = change.entity
          and locale = $user.locale
      ), (
        select text from i18nKeys
        where
              ID     = change.entity
          and locale = 'en'
      ), change.entity
    ) as entityLabel           : String(24) @title: '{i18n>Changes.entity}',
    COALESCE(
      (
        select text from i18nKeys
        where
              ID     = change.modification
          and locale = $user.locale
      ), (
        select text from i18nKeys
        where
              ID     = change.modification
          and locale = 'en'
      ), change.modification
    ) as modificationLabel     : String(16) @title: '{i18n>Changes.modification}',
    COALESCE(
      (
        select text from i18nKeys
        where
              ID     = change.objectID
          and locale = $user.locale
      ), (
        select text from i18nKeys
        where
              ID     = change.objectID
          and locale = 'en'
      ), change.objectID
    ) as objectID              : String(24) @title: '{i18n>Changes.objectID}',
    COALESCE(
      change.valueChangedFromLabel, change.valueChangedFrom
    ) as valueChangedFromLabel : String(5000) @title: '{i18n>Changes.valueChangedFrom}',
    COALESCE(
      change.valueChangedToLabel, change.valueChangedTo
    ) as valueChangedToLabel   : String(5000) @title: '{i18n>Changes.valueChangedTo}',
    
    // For the hierarchy
    null as LimitedDescendantCount : Int16 @UI.Hidden,
    null as DistanceFromRoot       : Int16 @UI.Hidden,
    null as DrillState             : String @UI.Hidden,
    null as LimitedRank            : Int16 @UI.Hidden,
  };

entity i18nKeys {
  key ID     : String(5000);
  key locale : String(100);
      text   : String(5000);
}

entity Changes : cuid {
  parent                : Association to one Changes;
  children              : Composition of many Changes
                            on children.parent = $self;

  attribute             : String(127)       @title: '{i18n>Changes.attribute}';
  valueChangedFrom      : String(5000)      @title: '{i18n>Changes.valueChangedFrom}'  @UI.MultiLineText;
  valueChangedTo        : String(5000)      @title: '{i18n>Changes.valueChangedTo}'    @UI.MultiLineText;
  valueChangedFromLabel : String(5000)      @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedToLabel   : String(5000)      @title: '{i18n>Changes.valueChangedTo}';

  entity                : String(150)       @UI.Hidden; // target entity on db level
  entityKey             : String(5000)      @title: '{i18n>Changes.entityKey}'; // primary key of target entity

  rootEntity            : String(5000)      @title: '{i18n>Changes.rootEntity}';
  rootEntityKey         : String(5000)      @title: '{i18n>Changes.rootKey}';

  // Business meaningful object id
  objectID              : String(5000)      @title: '{i18n>Changes.objectID}';
  rootObjectID          : String(5000)      @title: '{i18n>Changes.rootObjectID}';

  @title: '{i18n>Changes.modification}'
  modification          : String(6) enum {
    Create = 'create';
    Update = 'update';
    Delete = 'delete';
  };

  valueDataType         : String(5000)      @title: '{i18n>Changes.valueDataType}'     @UI.Hidden;
  createdAt             : managed:createdAt @title: '{i18n>Changes.createdAt}';
  createdBy             : managed:createdBy @title: '{i18n>Changes.createdBy}';
  transactionID         : Int64             @title: '{i18n>Changes.transactionID}';
}

annotate ChangeView with @(UI: {
  PresentationVariant #ChangeHierarchy: {RecursiveHierarchyQualifier: 'ChangeHierarchy',
  },
  PresentationVariant                 : {
    Visualizations: ['@UI.LineItem'],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
  },
  HeaderInfo                          : {
    $Type         : 'UI.HeaderInfoType',
    TypeName      : '{i18n>ChangeHistory}',
    TypeNamePlural: '{i18n>ChangeHistory}',
  },
  LineItem                            : [
    {
      Value             : modificationLabel,
      @UI.Importance : #Low
    },
    {
      Value             : entityLabel,
      @UI.Importance : #Medium
    },
    {
      Value             : objectID,
      @UI.Importance : #Medium
    },
    {
      Value             : attributeLabel,
      @UI.Importance : #Medium
    },
    {
      Value             : valueChangedToLabel,
      @UI.Importance : #High
    },
    {
      Value             : valueChangedFromLabel,
      @UI.Importance : #High
    },
    {
      Value             : createdAt,
      @UI.Importance : #Low
    },
    {
      Value             : createdBy,
      @UI.Importance : #High
    },
  ],
  DeleteHidden                        : true,
}) {
  valueChangedFrom @UI.Hidden;
  valueChangedTo @UI.Hidden;
  parent @UI.Hidden;
  entityKey @UI.Hidden;
  entity @UI.Hidden;
  attribute @UI.Hidden;
};

annotate ChangeView with @(
  Aggregation.RecursiveHierarchy #ChangeHierarchy        : {
    ParentNavigationProperty: parent, // navigates to a node's parent
    NodeProperty            : ID, // identifies a node, usually the key
  },
  Hierarchy.RecursiveHierarchyActions #ChangeHierarchy   : {ChangeSiblingForRootsSupported: false,
  },
  Hierarchy.RecursiveHierarchy #ChangeHierarchy          : {
    LimitedDescendantCount: LimitedDescendantCount,
    DistanceFromRoot      : DistanceFromRoot,
    DrillState            : DrillState,
    LimitedRank           : LimitedRank
  },
  // Disallow filtering on these properties from Fiori UIs
  Capabilities.FilterRestrictions.NonFilterableProperties: [
    'LimitedDescendantCount',
    'DistanceFromRoot',
    'DrillState',
    'LimitedRank'
  ],
  // Disallow sorting on these properties from Fiori UIs
  Capabilities.SortRestrictions.NonSortableProperties    : [
    'LimitedDescendantCount',
    'DistanceFromRoot',
    'DrillState',
    'LimitedRank'
  ],
);
