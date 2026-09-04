import psycopg2

conn = psycopg2.connect("dbname=shadow_atlas user=shadow_user password=shadow_password host=127.0.0.1")
cur = conn.cursor()

ws = 'Shadow_Museum_Atlas'
master_id = 'Linden-Museum Stuttgart'

# Define exact IDs to merge
ids_to_merge = [
    'Linden-Museums', 'Linden-Museum', 'Linden-Museum Stuttgart',
    'Linden-Museum\nStuttgart', 'Linden-­\nMuseums', 'Linden-Museums\nStuttgart',
    'Linden-Museums Stuttgart', 'LindenMuseums Stuttgart',
    'Linden-Museum-Stuttgart', 'Lindenmuseum Stuttgart'
]

count = 0
for dup_id in ids_to_merge:
    if dup_id == master_id: continue
    
    cur.execute("UPDATE edges SET source = %s WHERE source = %s AND workspace = %s", (master_id, dup_id, ws))
    cur.execute("UPDATE edges SET target = %s WHERE target = %s AND workspace = %s", (master_id, dup_id, ws))
    cur.execute("DELETE FROM nodes WHERE id = %s AND workspace = %s", (dup_id, ws))
    count += 1

conn.commit()
print(f"Merged {count} nodes into {master_id}")
