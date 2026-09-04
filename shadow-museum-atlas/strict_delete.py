with open('server.js', 'r') as f:
    lines = f.readlines()

out = []
skip = False
for line in lines:
    if "app.use((req, res) => {" in line:
        if "sendFile" not in line: # if it spans multiple lines
            skip = True
        else:
            continue # single line?
            
    if skip:
        if "});" in line:
            skip = False
        continue
    
    if "res.sendFile(path.join(buildPath, 'index.html'));" in line:
        continue # if it was somehow single line
        
    out.append(line)

new_code = "".join(out)
with open('server.js', 'w') as f:
    f.write(new_code)
print("Deleted ALL fallbacks!")
