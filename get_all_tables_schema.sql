-- Query to get all tables with their columns, data types, and constraints
-- Run this in your PostgreSQL database to see the complete schema

SELECT 
    t.table_name,
    c.column_name,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default,
    CASE 
        WHEN pk.column_name IS NOT NULL THEN 'PRIMARY KEY'
        WHEN fk.column_name IS NOT NULL THEN 'FOREIGN KEY -> ' || fk.foreign_table_name || '(' || fk.foreign_column_name || ')'
        WHEN ck.constraint_name IS NOT NULL THEN 'CHECK: ' || ck.check_clause
        WHEN uq.column_name IS NOT NULL THEN 'UNIQUE'
        ELSE ''
    END as constraints
FROM 
    information_schema.tables t
    LEFT JOIN information_schema.columns c ON t.table_name = c.table_name
    LEFT JOIN (
        SELECT 
            ku.table_name,
            ku.column_name,
            tc.constraint_name
        FROM 
            information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        WHERE 
            tc.constraint_type = 'PRIMARY KEY'
    ) pk ON t.table_name = pk.table_name AND c.column_name = pk.column_name
    LEFT JOIN (
        SELECT 
            ku.table_name,
            ku.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
        FROM 
            information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE 
            tc.constraint_type = 'FOREIGN KEY'
    ) fk ON t.table_name = fk.table_name AND c.column_name = fk.column_name
    LEFT JOIN (
        SELECT 
            tc.table_name,
            ku.column_name,
            tc.constraint_name,
            cc.check_clause
        FROM 
            information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
            JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
        WHERE 
            tc.constraint_type = 'CHECK'
    ) ck ON t.table_name = ck.table_name AND c.column_name = ck.column_name
    LEFT JOIN (
        SELECT 
            ku.table_name,
            ku.column_name
        FROM 
            information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        WHERE 
            tc.constraint_type = 'UNIQUE'
    ) uq ON t.table_name = uq.table_name AND c.column_name = uq.column_name
WHERE 
    t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
ORDER BY 
    t.table_name,
    c.ordinal_position;
