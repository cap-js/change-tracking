SELECT
    *,
    '$[' || lpad ("$$RN$$", 6, '0') as _path_
FROM
    (
        SELECT
            "$C".DrillState,
            "$C".ID,
            "$C".attributeLabel,
            "$C".createdAt,
            "$C".createdBy,
            "$C".entityLabel,
            "$C".modificationLabel,
            "$C".objectID,
            "$C".valueChangedFromLabel,
            "$C".valueChangedToLabel,
            "RANK" as "$$RN$$"
        FROM
            (
                SELECT
                    ID,
                    valueChangedFromLabel,
                    valueChangedToLabel,
                    objectID,
                    createdAt,
                    createdBy,
                    attributeLabel,
                    entityLabel,
                    modificationLabel,
                    HIERARCHY_RANK - 1 as "RANK",
                    CASE
                        WHEN HIERARCHY_TREE_SIZE = 1 THEN 'leaf'
                        WHEN min(HIERARCHY_DISTANCE) = 0 THEN 'leaf'
                        WHEN HIERARCHY_LEVEL <> 1 THEN 'expanded'
                        ELSE 'collapsed'
                    END as DrillState,
                    HIERARCHY_LEVEL - 1 as DistanceFromRoot
                FROM
                    HIERARCHY_ANCESTORS (
                        SOURCE HIERARCHY (
                            SOURCE (
                                SELECT
                                    "$C".ID,
                                    parent_ID as "$$PARENT_ID$$",
                                    locale,
                                    "TEXT",
                                    attribute,
                                    valueChangedFrom,
                                    valueChangedTo,
                                    valueChangedFromLabel,
                                    valueChangedToLabel,
                                    entity,
                                    entityKey,
                                    objectID,
                                    modification,
                                    valueDataType,
                                    createdAt,
                                    createdBy,
                                    transactionID,
                                    attributeLabel,
                                    entityLabel,
                                    modificationLabel,
                                    valueChangedFromLabelDateTime,
                                    valueChangedFromLabelDateTimeWTZ,
                                    valueChangedFromLabelTime,
                                    valueChangedFromLabelDate,
                                    valueChangedFromLabelTimestamp,
                                    valueChangedToLabelDateTime,
                                    valueChangedToLabelDateTimeWTZ,
                                    valueChangedToLabelTime,
                                    valueChangedToLabelDate,
                                    valueChangedToLabelTimestamp,
                                    valueTimeZone,
                                    parent_entityKey,
                                    parent_entity,
                                    parent_parent_entityKey,
                                    parent_parent_entity,
                                    "$C".ID as NODE_ID,
                                    parent_ID as PARENT_ID
                                FROM
                                    AdminService_ChangeView as "$C"
                                    INNER JOIN AdminService_Books as "$B" ON (
                                        (
                                            "$C".entityKey = "$B".ID
                                            and "$C".entity = 'sap.capire.bookshop.Books'
                                        )
                                        or (
                                            "$C".parent_entityKey = "$B".ID
                                            and "$C".parent_entity = 'sap.capire.bookshop.Books'
                                        )
                                        or (
                                            "$C".parent_parent_entityKey = "$B".ID
                                            and "$C".parent_parent_entity = 'sap.capire.bookshop.Books'
                                        )
                                    )
                                    and "$B".ID = '27882070-9f7d-40b2-b49f-5b5576e6ae57'
                            ) SIBLING
                            ORDER BY
                                createdAt DESC,
                                ID ASC
                        ) AS "$C" START
                        WHERE
                            (1 = 1)
                    )
                WHERE
                    HIERARCHY_LEVEL <= 1
                GROUP BY
                    NODE_ID,
                    PARENT_ID,
                    HIERARCHY_RANK,
                    HIERARCHY_LEVEL,
                    HIERARCHY_TREE_SIZE,
                    ID,
                    valueChangedFromLabel,
                    valueChangedToLabel,
                    objectID,
                    createdAt,
                    createdBy,
                    attributeLabel,
                    entityLabel,
                    modificationLabel
                ORDER BY
                    HIERARCHY_RANK ASC
            ) AS "$C"
        LIMIT
            210
        OFFSET
            0
    ) as "$C";

WITH
    "$TA0" as (
        SELECT
            *,
            '$[' || lpad ("$$RN$$", 6, '0') as _path_
        FROM
            (
                SELECT
                    "$C".DrillState,
                    "$C".ID,
                    "$C".attributeLabel,
                    "$C".createdAt,
                    "$C".createdBy,
                    "$C".entityLabel,
                    "$C".modificationLabel,
                    "$C".objectID,
                    "$C".valueChangedFromLabel,
                    "$C".valueChangedToLabel,
                    "RANK" as "$$RN$$"
                FROM
                    (
                        SELECT
                            ID,
                            valueChangedFromLabel,
                            valueChangedToLabel,
                            objectID,
                            createdAt,
                            createdBy,
                            attributeLabel,
                            entityLabel,
                            modificationLabel,
                            HIERARCHY_RANK - 1 as "RANK",
                            CASE
                                WHEN HIERARCHY_TREE_SIZE = 1 THEN 'leaf'
                                WHEN min(HIERARCHY_DISTANCE) = 0 THEN 'leaf'
                                WHEN HIERARCHY_LEVEL <> 1 THEN 'expanded'
                                ELSE 'collapsed'
                            END as DrillState,
                            HIERARCHY_LEVEL - 1 as DistanceFromRoot
                        FROM
                            HIERARCHY_ANCESTORS (
                                SOURCE HIERARCHY (
                                    SOURCE (
                                        SELECT
                                            "$C".ID,
                                            parent_ID as "$$PARENT_ID$$",
                                            locale,
                                            "TEXT",
                                            attribute,
                                            valueChangedFrom,
                                            valueChangedTo,
                                            valueChangedFromLabel,
                                            valueChangedToLabel,
                                            entity,
                                            entityKey,
                                            objectID,
                                            modification,
                                            valueDataType,
                                            createdAt,
                                            createdBy,
                                            transactionID,
                                            attributeLabel,
                                            entityLabel,
                                            modificationLabel,
                                            valueChangedFromLabelDateTime,
                                            valueChangedFromLabelDateTimeWTZ,
                                            valueChangedFromLabelTime,
                                            valueChangedFromLabelDate,
                                            valueChangedFromLabelTimestamp,
                                            valueChangedToLabelDateTime,
                                            valueChangedToLabelDateTimeWTZ,
                                            valueChangedToLabelTime,
                                            valueChangedToLabelDate,
                                            valueChangedToLabelTimestamp,
                                            valueTimeZone,
                                            parent_entityKey,
                                            parent_entity,
                                            parent_parent_entityKey,
                                            parent_parent_entity,
                                            "$C".ID as NODE_ID,
                                            parent_ID as PARENT_ID
                                        FROM
                                            AdminService_ChangeView as "$C"
                                            INNER JOIN AdminService_Books as "$B" ON (
                                                (
                                                    "$C".entityKey = "$B".ID
                                                    and "$C".entity = 'sap.capire.bookshop.Books'
                                                )
                                                or (
                                                    "$C".parent_entityKey = "$B".ID
                                                    and "$C".parent_entity = 'sap.capire.bookshop.Books'
                                                )
                                                or (
                                                    "$C".parent_parent_entityKey = "$B".ID
                                                    and "$C".parent_parent_entity = 'sap.capire.bookshop.Books'
                                                )
                                            )
                                            and "$B".ID = '27882070-9f7d-40b2-b49f-5b5576e6ae57'
                                    ) SIBLING
                                    ORDER BY
                                        createdAt DESC,
                                        ID ASC
                                ) AS "$C" START
                                WHERE
                                    (1 = 1)
                            )
                        WHERE
                            HIERARCHY_LEVEL <= 1
                        GROUP BY
                            NODE_ID,
                            PARENT_ID,
                            HIERARCHY_RANK,
                            HIERARCHY_LEVEL,
                            HIERARCHY_TREE_SIZE,
                            ID,
                            valueChangedFromLabel,
                            valueChangedToLabel,
                            objectID,
                            createdAt,
                            createdBy,
                            attributeLabel,
                            entityLabel,
                            modificationLabel
                        ORDER BY
                            HIERARCHY_RANK ASC
                    ) AS "$C"
                LIMIT
                    210
                OFFSET
                    0
            ) as "$C"
    )
SELECT
    _path_ as "_path_",
    '{}' as "_blobs_",
    '{}' as "_expands_",
    (
        SELECT
            DrillState as "DrillState",
            ID as "ID",
            attributeLabel as "attributeLabel",
            to_char (createdAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') as "createdAt",
            createdBy as "createdBy",
            entityLabel as "entityLabel",
            modificationLabel as "modificationLabel",
            objectID as "objectID",
            valueChangedFromLabel as "valueChangedFromLabel",
            valueChangedToLabel as "valueChangedToLabel"
        FROM
            JSON_TABLE (
                '{}',
                '$' COLUMNS ("'$$FaKeDuMmYCoLuMn$$'" FOR ORDINALITY)
            ) FOR JSON (
                'format' = 'no',
                'omitnull' = 'no',
                'arraywrap' = 'no'
            ) RETURNS NVARCHAR (2147483647)
    ) as "_json_"
FROM
    "$TA0"
ORDER BY
    "_path_" ASC;