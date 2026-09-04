with open('server.js', 'r') as f:
    code = f.read()

catch_all = """app.use((req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
});"""

if catch_all in code:
    code = code.replace(catch_all, "")
    
    # Inject before server.listen
    code = code.replace("server.listen(PORT", catch_all + "\n\nserver.listen(PORT")
    
    with open('server.js', 'w') as f:
        f.write(code)
    print("Fixed!")
else:
    print("Not found!")
