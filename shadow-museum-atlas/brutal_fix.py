with open('server.js', 'r') as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if "app.use((req, res) => {" in line:
        skip = True
    
    if skip:
        if "});" in line:
            skip = False
        continue
    
    new_lines.append(line)

new_code = "".join(new_lines)

# Now inject the catch all BEFORE server.listen
catch_all = """
app.use((req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
});

server.listen(
"""
new_code = new_code.replace("server.listen(", catch_all)

with open('server.js', 'w') as f:
    f.write(new_code)
print("Brutally fixed route order!")
