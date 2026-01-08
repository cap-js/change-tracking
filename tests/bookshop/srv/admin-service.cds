using {sap.capire.bookshop as my} from '../db/schema';

service AdminService {
  @odata.draft.enabled
  entity BookStores @(cds.autoexpose) as projection on my.BookStores;

  @odata.draft.enabled
  entity RootEntity @(cds.autoexpose) as projection on my.RootEntity;

  @odata.draft.enabled
  entity Schools @(cds.autoexpose)    as projection on my.Schools;

  @odata.draft.enabled
  entity RootSampleDraft              as projection on my.RootSampleDraft;

  entity RootObject                   as projection on my.RootObject;
  entity Level1Object                 as projection on my.Level1Object;
  entity Level2Object                 as projection on my.Level2Object;
  entity Level3Object                 as projection on my.Level3Object;
  entity Level1Entity                 as projection on my.Level1Entity;
  entity Level2Entity                 as projection on my.Level2Entity;
  entity Level3Entity                 as projection on my.Level3Entity;
  entity RootSample                   as projection on my.RootSample;
  entity Level1Sample                 as projection on my.Level1Sample;
  entity AssocOne                     as projection on my.AssocOne;
  entity AssocTwo                     as projection on my.AssocTwo;
  entity AssocThree                   as projection on my.AssocThree;
  entity Authors                      as projection on my.Authors;
  entity Report                       as projection on my.Report;
  entity Order                        as projection on my.Order;
  entity Order.Items                  as projection on my.Order.Items;
  entity OrderItem                    as projection on my.OrderItem;

  entity OrderItemNote                as projection on my.OrderItemNote
    actions {
      @Common.SideEffects             : {TargetEntities: [in]}
      action activate();
    };

  entity Volumns                      as projection on my.Volumns
    actions {
      @Common.SideEffects             : {TargetEntities: [in]}
      action activate();
    };

  entity Level2Sample                 as projection on my.Level2Sample
    actions {
      @Common.SideEffects             : {TargetEntities: [in]}
      action activate();
    };

  entity Customers                    as projection on my.Customers;
}