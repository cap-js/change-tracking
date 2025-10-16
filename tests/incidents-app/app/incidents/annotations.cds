using ProcessorService as service from '../../srv/services';
using from '../../db/schema';

annotate service.Customers with @title : '{i18n>Customer}';
annotate service.Incidents with @title : '{i18n>Incident}';
annotate service.Incidents with @odata.draft.enabled;

annotate service.Incidents with @(
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : title,
            Label : '{i18n>Title}',
        },
        {
            $Type : 'UI.DataField',
            Value : customer.name,
            Label : '{i18n>Customer}',
        },
        {
            $Type : 'UI.DataField',
            Value : status.descr,
            Criticality : status.criticality,
            Label : '{i18n>Status}',
        },
        {
            $Type : 'UI.DataField',
            Value : urgency.descr,
            Label : '{i18n>Urgency}',
        },
    ]
);
annotate service.Incidents with @(
    UI.FieldGroup #GeneratedGroup1 : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : title,
                Label : '{i18n>Title}',
            },
                 {
                $Type : 'UI.DataField',
                Value : customer_ID,
                Label : '{i18n>Customer}',
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.CollectionFacet',
            Label : '{i18n>Overview}',
            ID : 'i18nOverview',
            Facets : [
                {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup1',
        },
                {
                    $Type : 'UI.ReferenceFacet',
                    Label : '{i18n>Details}',
                    ID : 'i18nDetails',
                    Target : '@UI.FieldGroup#i18nDetails',
                },],
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : '{i18n>Conversation}',
            ID : 'i18nConversation',
            Target : 'conversation/@UI.LineItem#i18nConversation1',
        },
    ]
);
annotate service.Incidents with @(
    UI.SelectionFields : [
        urgency_code,
        status_code,
    ]
);
annotate service.Incidents with {
    status @Common.Label : '{i18n>Status}'
};
annotate service.Incidents with {
    urgency @Common.Label : '{i18n>Urgency}'
};
annotate service.Incidents with {
    status @Common.ValueListWithFixedValues : true
};
annotate service.Incidents with {
    urgency @Common.ValueListWithFixedValues : true
};
annotate service.Incidents with @(
    UI.HeaderInfo : {
        Title : {
            $Type : 'UI.DataField',
            Value : title,
        },
        TypeName : '',
        TypeNamePlural : '',
        Description : {
            $Type : 'UI.DataField',
            Value : customer.name,
        },
        TypeImageUrl : 'sap-icon://alert',
    }
);
annotate service.Incidents with @(
    UI.FieldGroup #i18nDetails : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : status_code,
                Criticality : status.criticality,
            },
            {
                $Type : 'UI.DataField',
                Value : urgency_code,
            },],
    }
);
annotate service.Status with {
    code @Common.Text : descr
};
annotate service.Urgency with {
    code @Common.Text : descr
};
annotate service.Incidents with {
    customer @(Common.ValueList : {
            $Type : 'Common.ValueListType',
            CollectionPath : 'Customers',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : customer_ID,
                    ValueListProperty : 'ID',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'name',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'email',
                },
            ],
        },
        Common.ValueListWithFixedValues : false
)};

annotate service.Incidents with {
    status @Common.Text : status.descr
};
annotate service.Incidents with {
    urgency @Common.Text : urgency.descr
};
annotate service.Incidents with {
    customer @Common.Text : {
        $value : customer.name,
        ![@UI.TextArrangement] : #TextOnly,
    }
};
annotate service.Incidents.conversation with @(
    title : '{i18n>Conversation}',
    UI.LineItem #i18nConversation1 : [
        {
            $Type : 'UI.DataField',
            Value : author,
            Label : '{i18n>Author}',
        },
        {
            $Type : 'UI.DataField',
            Value : timestamp,
            Label : '{i18n>ConversationDate}',
        },{
            $Type : 'UI.DataField',
            Value : message,
            Label : '{i18n>Message}',
        },]
);
