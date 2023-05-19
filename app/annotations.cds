using {sap.sme.changelog.ChangeView as ChangeView} from '../db';

annotate ChangeView with @(UI : {
    PresentationVariant : {
        SortOrder      : [{
            Property   : createdAt,
            Descending : true
        }],
        Visualizations : ['@UI.LineItem'],
        RequestAtLeast : [
            parentKey,
            serviceEntity,
            serviceEntityPath
        ]
    },
    DeleteHidden        : true,
    LineItem            : [
        {
            $Type : 'UI.DataField',
            Value : objectID
        },
        {
            $Type : 'UI.DataField',
            Value : entity
        },
        {
            $Type : 'UI.DataField',
            Value : parentObjectID
        },
        {
            $Type : 'UI.DataField',
            Value : attribute
        },
        {
            $Type : 'UI.DataField',
            Value : valueChangedTo
        },
        {
            $Type : 'UI.DataField',
            Value : valueChangedFrom
        },
        {
            $Type : 'UI.DataField',
            Value : createdBy
        },
        {
            $Type : 'UI.DataField',
            Value : createdAt
        },
        {
            $Type : 'UI.DataField',
            Value : modification
        }
    ]
});
