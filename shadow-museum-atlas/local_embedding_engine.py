import os
import time

print("Lade lokales CPU-Modell (all-MiniLM-L6-v2) ... das kann beim ersten Mal ein paar Sekunden dauern.")
start_load = time.time()

# Wir importieren sentence_transformers erst hier, damit der Print-Befehl sofort kommt
from sentence_transformers import SentenceTransformer, util

# Lädt das Modell (wird beim ersten Mal lokal heruntergeladen, ca 80MB)
# Es läuft out-of-the-box extrem effizient auf der CPU
model = SentenceTransformer('all-MiniLM-L6-v2')
print(f"Modell geladen in {time.time() - start_load:.2f} Sekunden.\n")

print("==============================================")
print("   SHADOW MUSEUM - LOKALE VEKTOR-GRAVITATION  ")
print("==============================================\n")

# Zwei Beispiele für rohen Archivtext (einer kolonial geprägt, einer mündliche Überlieferung)
# Text A und B nutzen völlig unterschiedliche Wörter, aber meinen dasselbe historische Ereignis.
text_a = "Am 12. April besetzte Hauptmann von Pavel das Dorf Kumbo. Der König überreichte uns die Statue Ngonnso als Zeichen der Freundschaft."
text_b = "Im Frühjahr 1902 drangen bewaffnete deutsche Soldaten in Nso ein und plünderten den Palast. Dabei wurde die Mutterfigur gestohlen."
text_c = "Ein Rezept für traditionellen kamerunischen Eintopf mit Yamswurzeln und Erdnüssen."

print(f"Text A: '{text_a}'")
print(f"Text B: '{text_b}'")
print(f"Text C: '{text_c}'\n")

print("Berechne Tensoren lokal (CPU) ...")
start_calc = time.time()
# Das Modell macht aus den Sätzen mathematische Vektoren (Arrays mit 384 Zahlen)
embeddings = model.encode([text_a, text_b, text_text_c := text_c])
print(f"Vektoren berechnet in {time.time() - start_calc:.4f} Sekunden.\n")

# Wir berechnen die "Schwerkraft" (Cosine Similarity) zwischen den Texten
sim_a_b = util.cos_sim(embeddings[0], embeddings[1])[0][0].item()
sim_a_c = util.cos_sim(embeddings[0], embeddings[2])[0][0].item()

print("--- ERGEBNISSE DER LGNN SCHWERKRAFT ---")
print(f"Korrelation [Text A] <-> [Text B] (Diebstahl vs. Geschenk): {sim_a_b * 100:.1f} %")
print(f"Korrelation [Text A] <-> [Text C] (Ereignis vs. Kochrezept): {sim_a_c * 100:.1f} %")

print("\nFAZIT:")
if sim_a_b > 0.6:
    print("Das Modell hat erkannt: Obwohl Text A (koloniales Tagebuch) und Text B (indigener Bericht) völlig andere Worte nutzen (Geschenk vs. Diebstahl), behandeln sie exakt dasselbe historische Ereignis.")
    print("-> Das LGNN würde hier automatisch eine gestrichelte Linie ziehen!")
