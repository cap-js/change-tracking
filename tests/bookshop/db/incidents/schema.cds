using { cuid, managed, sap.common.CodeList, Country } from '@sap/cds/common';

namespace sap.capire.incidents;

/**
 * Customers using products sold by our company.
 * Customers can create support Incidents.
 */
@changelog : [name]
entity Customers : managed {
  key ID         : String;
  firstName      : String @changelog;
  lastName       : String @changelog;
  name           : String = firstName ||' '|| lastName;
  email          : EMailAddress @changelog;
  phone          : PhoneNumber  @changelog;
  creditCardNo   : String(16) @assert.format: '^[1-9]\d{15}$';
  address      : Composition of one Addresses on address.customer = $self;
  incidents      : Association to many Incidents on incidents.customer = $self;
}

entity Addresses : cuid, managed {
  customer       : Association to Customers;
  city           : String;
  postCode       : String;
  streetAddress  : String;
}


/**
 * Incidents created by Customers.
 */
@changelog : [customer.name]
@title : 'Support Incidents'
entity Incidents : cuid, managed {
  customer       : Association to Customers @changelog : [customer.name];
  title          : String @title: 'Title';
  urgency        : Association to Urgency default 'M';
  status         : Association to Status default 'N' @changelog : [status.descr] @title : 'Status';
  status2        : Association to Status default 'N' @changelog : [status.descr, ID] @title : 'Status';
  date           : Date @title : 'date' @changelog;
  datetime       : DateTime @title : 'datetime' @changelog;
  datetimeWTimeZone : DateTime @title : 'datetime with TimeZone' @changelog @Common : { Timezone : 'Asia/Riyadh' };
  datetimeWDynamicTimeZone : DateTime @title : 'datetime with dynamic TimeZone' @changelog @Common : { Timezone : timezone };
  timezone : String default 'Asia/Riyadh' @Common.IsTimezone;
  time           : Time @title : 'time' @changelog;
  timestamp      : Timestamp @title : 'timestamp' @changelog;
  decimalProp : Decimal @title : 'Decimal prop' @changelog;
  @changelog: false
  conversation   : Composition of many {
    key ID    : UUID;
    timestamp : type of managed:createdAt;
    author    : type of managed:createdBy;
    message   : String @changelog;
    descr     : Composition of one {
      text : String @changelog;
    };
  };
  tasks : Composition of many IncidentTasks on tasks.incident = $self;
  task : Composition of one IncidentTasks on task.incident = $self and task.title = 'ANC';
}

@changelog : [title, timestamp]
entity IncidentTasks : cuid, managed {
  incident    : Association to Incidents;
  title       : String @title: 'Task Title' @changelog;
  description : String @changelog;
}

entity Status : CodeList {
  key code    : String enum {
    new        = 'N';
    assigned   = 'A';
    in_process = 'I';
    on_hold    = 'H';
    resolved   = 'R';
    closed     = 'C';
  };
  criticality : Integer;
}

entity Urgency : CodeList {
  key code : String enum {
    high   = 'H';
    medium = 'M';
    low    = 'L';
  };
}

type EMailAddress : String;
type PhoneNumber  : String;


entity MultiKeyScenario {
  key GJAHR: Integer;
  key BUKRS: String(40);
      foo1: String @changelog;
      datetime : DateTime @changelog @Common.Timezone : timezone;
      timezone: String default 'Europe/Amsterdam' @Common.IsTimezone;
}

@Capabilities : { NavigationRestrictions : {
    RestrictedProperties : [
        {
            NavigationProperty : changes,
            ReadRestrictions : {
                Readable : true,
            },
        },
    ],
}, }
entity BooksNotID {
  key NOT_ID : String;
      @changelog
      title  : String;
      @changelog
      pages : Composition of many PagesNotID on pages.book = $self;
}

entity PagesNotID {
  key NOT_ID : String;
      book : Association to one BooksNotID;
      @changelog : [book.title, page]
      page  : Integer;
}



entity Orders : cuid {
  abc : String @changelog;
  @changelog
  orderProducts : Composition of many OrderProducts on orderProducts.order = $self;
}

entity OrderProducts : cuid {
  order : Association to one Orders;
  country : Country @changelog : [country.name];
  price: Decimal @changelog;
}