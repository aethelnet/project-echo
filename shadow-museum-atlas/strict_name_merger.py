import psycopg2
import re
import difflib

def normalize_label(label):
    # Remove all non-alphanumeric characters and lowercase
    return re.sub(r'[^a-z0-9]', '', str(label).lower())

def is_strict_duplicate(label1, label2):
    norm1 = normalize_label(label1)
    norm2 = normalize_label(label2)
    
    # If they are exactly the same after stripping spaces/punctuation (e.g. "Linden-Museum" vs "Lindenmuseum")
    if norm1 == norm2 and len(norm1) > 0:
        return True
        
    # If they are extremely similar (e.g. 95% match)
    # This catches minor spelling mistakes
    if len(norm1) > 3 and len(norm2) > 3:
        ratio = difflib.SequenceMatcher(None, norm1, norm2).ratio()
        if ratio > 0.95:
            return True
            
    return False

def run_strict_merger(workspace="Shadow_Museum_Atlas"):
    print(f"🚀 Starte Stufe 1: Strikter Schreibfehler-Filter für {workspace}...")
    
    try:
        conn = psycopg2.connect("dbname=shadow_atlas user=shadow_user password=shadow_password host=127.0.0.1")
        cur = conn.cursor()
        
        # Hol alle Knoten
        cur.execute("SELECT id, label FROM nodes WHERE workspace = %s", (workspace,))
        nodes = cur.fetchall()
        
        merged_count = 0
        skip_list = set()
        
        for i in range(len(nodes)):
            if nodes[i][0] in skip_list:
                continue
                
            primary_id, primary_label = nodes[i]
            
            for j in range(i + 1, len(nodes)):
                if nodes[j][0] in skip_list:
                    continue
                    
                duplicate_id, duplicate_label = nodes[j]
                
                # Check strict duplicate
                if is_strict_duplicate(primary_label, duplicate_label):
                    print(f"🔗 Verschmelze: '{duplicate_label}' -> '{primary_label}'")
                    
                    # Edges umbiegen
                    cur.execute("UPDATE edges SET source = %s WHERE source = %s AND workspace = %s", (primary_id, duplicate_id, workspace))
                    cur.execute("UPDATE edges SET target = %s WHERE target = %s AND workspace = %s", (primary_id, duplicate_id, workspace))
                    
                    # Duplikat löschen
                    cur.execute("DELETE FROM nodes WHERE id = %s AND workspace = %s", (duplicate_id, workspace))
                    
                    skip_list.add(duplicate_id)
                    merged_count += 1
                    
        conn.commit()
        print(f"✅ Stufe 1 abgeschlossen! {merged_count} Schreibfehler/Syntax-Duplikate wurden restlos beseitigt.")
        
    except Exception as e:
        print(f"❌ Fehler: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    run_strict_merger()
