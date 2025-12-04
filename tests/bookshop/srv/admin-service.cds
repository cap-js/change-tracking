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
      @cds.odata.bindingparameter.name: 'self'
      @Common.SideEffects             : {TargetEntities: [self]}
      action activate();
    };

  entity Volumns                      as projection on my.Volumns
    actions {
      @cds.odata.bindingparameter.name: 'self'
      @Common.SideEffects             : {TargetEntities: [self]}
      action activate();
    };

  entity Level2Sample                 as projection on my.Level2Sample
    actions {
      @cds.odata.bindingparameter.name: 'self'
      @Common.SideEffects             : {TargetEntities: [self]}
      action activate();
    };

  entity Customers                    as projection on my.Customers;
}

annotate AdminService.RootEntity with @changelog: [name] {
  name            @changelog;
  child           @changelog                    : [child.child.child.title];
  lifecycleStatus @changelog                    : [lifecycleStatus.name];
  info            @changelog                    : [info.info.info.name];
};

annotate AdminService.Level1Entity with @changelog: [parent.lifecycleStatus.name] {
  title @changelog;
  child @changelog                                : [child.title];
};

annotate AdminService.Level2Entity with @changelog: [parent.parent.lifecycleStatus.name] {
  title @changelog;
  child @changelog                                : [child.title];
};

annotate AdminService.Level3Entity with @changelog: [parent.parent.parent.lifecycleStatus.name] {
  title @changelog;
}

annotate AdminService.AssocOne with {
  name @changelog;
  info @changelog: [info.info.name]
};

annotate AdminService.AssocTwo with {
  name @changelog;
  info @changelog: [info.name]
};

annotate AdminService.AssocThree with {
  name @changelog;
};

annotate AdminService.RootObject with {
  title @changelog;
}

annotate AdminService.Level1Object with {
  title @changelog;
  child @changelog: [child.title];
}

annotate AdminService.Level2Object with {
  title @changelog;
  child @changelog: [child.title];
};

annotate AdminService.Level3Object with {
  title  @changelog;
  parent @changelog: [parent.parent.parent.title]
};

annotate AdminService.Authors with {
  name @(Common.Label: '{i18n>serviceAuthors.name}');
};


annotate AdminService.OrderHeader with {
  status @changelog;
}

annotate AdminService.OrderItem with {
  quantity @changelog;
  customer @changelog: [
    customer.country,
    customer.name,
    customer.city,
  ];
  order    @changelog: [
    order.report.comment,
    order.status
  ];
}

annotate AdminService.OrderItemNote with {
  content          @changelog;
  ActivationStatus @changelog: [ActivationStatus.name];
}

annotate AdminService.Customers with {
  name    @changelog;
  city    @changelog;
  country @changelog;
  age     @changelog;
}

annotate AdminService.Schools with {
  classes @changelog: [
    classes.name,
    classes.teacher
  ]
};

annotate AdminService.RootSampleDraft with @changelog: [
  ID,
  title
] {
  title  @changelog  @title: 'Root Draft Title';
}

annotate AdminService.Level1SampleDraft with @changelog: [
  ID,
  title,
  parent.ID
] {
  title  @changelog  @title: 'Level1 Draft Title';
}

annotate AdminService.Level2SampleDraft with @changelog: [
  ID,
  title,
  parent.parent.ID
] {
  title  @changelog  @title: 'Level2 Draft Title';
};

annotate AdminService.RootSample with @changelog: [
  ID,
  title
] {
  title  @changelog  @title: 'Root Sample Title';
}

annotate AdminService.Level1Sample with @changelog: [
  ID,
  title,
  parent.ID
] {
  title  @changelog  @title: 'Level1 Sample Title';
}

annotate AdminService.Level2Sample with @changelog: [
  ID,
  title,
  parent.parent.ID
] {
  title  @changelog  @title: 'Level2 Sample Title';
};
