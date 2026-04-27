using {sap.change_tracking as my} from '../db/index';
using {sap.changelog as change} from '@cap-js/change-tracking';

service VariantTesting {
  @cds.redirection.target
  entity DifferentFieldTypes as projection on my.DifferentFieldTypes;

  entity GrandRootSample as projection on my.GrandRootSample;
  entity RootSample as projection on my.RootSample;
  entity Level1Sample as projection on my.Level1Sample;
  entity Level2Sample as projection on my.Level2Sample;

  @odata.draft.enabled
  entity TrackingComposition as projection on my.TrackingComposition;

  entity ComposedEntities        as projection on my.ComposedEntities;
  entity ExplicitCompositionOne  as projection on my.ExplicitCompositionOne;
  entity ExplicitCompositionMany as projection on my.ExplicitCompositionMany;

  entity CompositeKeyParent as projection on my.CompositeKeyParent;

  entity ObjectIdFallbackParent as projection on my.ObjectIdFallbackParent;

  entity ChangeView as projection on change.ChangeView;

  @changelog: false
  entity NotTrackedDifferentFieldTypes as projection on my.DifferentFieldTypes;


  entity SelectionView as select from my.DifferentFieldTypes;

  entity ExtendedEvents as select from my.ExtendedEvents;
  entity DataExtractionSummaryView as select from my.DataExtractionSummaryView;

  entity CustomTypeKeyTable as projection on my.CustomTypeKeyTable;

}

// Test: changes facet nested in CollectionFacet targeting changes/@UI.LineItem — plugin must not add a duplicate
annotate VariantTesting.RootSample with @(UI.Facets: [{
  $Type  : 'UI.CollectionFacet',
  ID     : 'TestCollection',
  Label  : 'Test Collection',
  Facets : [{
    $Type  : 'UI.ReferenceFacet',
    ID     : 'CustomChangesFacet',
    Label  : 'Custom Changes',
    Target : 'changes/@UI.LineItem',
  }]
}]);

// Test: changes facet nested in CollectionFacet targeting changes/@UI.PresentationVariant — plugin must not add a duplicate
annotate VariantTesting.DifferentFieldTypes with @(UI.Facets: [{
  $Type  : 'UI.CollectionFacet',
  ID     : 'TestCollection',
  Label  : 'Test Collection',
  Facets : [{
    $Type  : 'UI.ReferenceFacet',
    ID     : 'CustomChangesFacet',
    Label  : 'Custom Changes',
    Target : 'changes/@UI.PresentationVariant',
  }]
}]);

// Test: changes facet nested three levels deep in CollectionFacets — plugin must not add a duplicate
annotate VariantTesting.CompositeKeyParent with @(UI.Facets: [{
  $Type  : 'UI.CollectionFacet',
  ID     : 'Level1',
  Label  : 'Level 1',
  Facets : [{
    $Type  : 'UI.CollectionFacet',
    ID     : 'Level2',
    Label  : 'Level 2',
    Facets : [{
      $Type  : 'UI.CollectionFacet',
      ID     : 'Level3',
      Label  : 'Level 3',
      Facets : [{
        $Type  : 'UI.ReferenceFacet',
        ID     : 'CustomChangesFacet',
        Label  : 'Custom Changes',
        Target : 'changes/@UI.PresentationVariant',
      }]
    }]
  }]
}]);