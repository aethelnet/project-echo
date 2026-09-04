with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/museum_auto_crawler.py', 'r') as f:
    lines = f.readlines()

with open('/home/nikahrlyn/auratic-systems-prime/shadow-museum-atlas/museum_auto_crawler.py', 'w') as f:
    for line in lines:
        if line.startswith("        import requests"):
            f.write(line.replace("        ", "        ", 1)) # Wait, I need to see the exact indentation.
        # Just write it back but fix it
