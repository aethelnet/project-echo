import os
import fitz  # PyMuPDF
import io
from PIL import Image

DROPZONE_DIR = "data_dropzone/verified_research"

def extract_images_from_pdfs():
    print("==============================================")
    print("   SHADOW MUSEUM - PDF IMAGE EXTRACTOR        ")
    print("==============================================\n")
    
    pdf_files = [f for f in os.listdir(DROPZONE_DIR) if f.lower().endswith('.pdf')]
    
    if not pdf_files:
        print("Keine PDFs in der Dropzone gefunden.")
        return
        
    for pdf_filename in pdf_files:
        pdf_path = os.path.join(DROPZONE_DIR, pdf_filename)
        print(f"📄 Öffne PDF: {pdf_filename}")
        
        pdf_document = fitz.open(pdf_path)
        image_count = 0
        
        for page_num in range(len(pdf_document)):
            page = pdf_document[page_num]
            image_list = page.get_images(full=True)
            
            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = pdf_document.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                # Filtere zu kleine Bilder (Icons, Logos)
                image = Image.open(io.BytesIO(image_bytes))
                if image.width < 100 or image.height < 100:
                    continue
                    
                image_name = f"{os.path.splitext(pdf_filename)[0]}_page{page_num+1}_img{img_index}.{image_ext}"
                image_path = os.path.join(DROPZONE_DIR, image_name)
                
                with open(image_path, "wb") as f:
                    f.write(image_bytes)
                    
                print(f"   [🟢 EXTRAHIERT] Bild gespeichert: {image_name}")
                image_count += 1
                
        print(f"✅ {image_count} relevante Bilder aus {pdf_filename} extrahiert.\n")

if __name__ == "__main__":
    extract_images_from_pdfs()
