using { sap.capire.incidents as my } from '../db/schema';

/**
 * Service used by support personell, i.e. the incidents' 'processors'.
 */
 @path: 'processor'
service ProcessorService {
  @cds.redirection.target
  entity Incidents as projection on my.Incidents actions {
    action setToDone() returns Incidents;
  };

  entity Customers @readonly as projection on my.Customers;
  
  @odata.draft.enabled
  entity MultiKeyScenario as projection on my.MultiKeyScenario;
  @odata.draft.enabled
  entity BooksNotID as projection on my.BooksNotID;

  entity Orders as projection on my.Orders;
  entity ExpressionScenarios as projection on my.ExpressionScenarios;
}

/**
 * Service used by administrators to manage customers and incidents.
 */
service IncidentsAdminService {
  entity Customers as projection on my.Customers;
  entity Incidents as projection on my.Incidents;
}

service LocalizationService {
  entity Incidents as projection on my.Incidents {
    *,
    status as renamedStatus
  } excluding {status};

  entity DynamicLocalizationScenarios as projection on my.DynamicLocalizationScenarios;
  @odata.draft.enabled
  entity ExpressionScenarios as projection on my.ExpressionScenarios;
}

annotate ProcessorService.Incidents with @odata.draft.enabled; 
annotate ProcessorService with @(requires: 'support');
annotate IncidentsAdminService with @(requires: 'admin');
annotate IncidentsAdminService with @changelog: false;
