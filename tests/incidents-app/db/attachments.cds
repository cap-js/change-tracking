
using { sap.capire.incidents as my } from './schema';
using { Attachments } from '@cap-js/attachments';

extend my.Incidents with {
  attachments: Composition of many Attachments;
  @attachments.disable_facet
  hiddenAttachments: Composition of many Attachments;

  @UI.Hidden
  hiddenAttachments2: Composition of many Attachments;
}

@UI.Facets : [
  {
    $Type : 'UI.ReferenceFacet',
    Target : 'attachments/@UI.LineItem',
    Label : 'My custom attachments',
  }
]
extend my.Customers with {
  attachments: Composition of many Attachments;
}