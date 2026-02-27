using {sap.change_tracking as my} from '../db/index';
using {sap.changelog as change} from '@cap-js/change-tracking';

service VariantTesting {
  @cds.redirection.target
  entity DifferentFieldTypes as projection on my.DifferentFieldTypes;

  entity RootSample as projection on my.RootSample;
  entity Level1Sample as projection on my.Level1Sample;
  entity Level2Sample as projection on my.Level2Sample;

  @odata.draft.enabled
  entity TrackingComposition as projection on my.TrackingComposition;

  entity ComposedEntities as projection on my.ComposedEntities;

  entity ChangeView as projection on change.ChangeView;

  @changelog: false
  entity NotTrackedDifferentFieldTypes as projection on my.DifferentFieldTypes;


  entity SelectionView as select from my.DifferentFieldTypes;

}