with open('src/App.tsx', 'r') as f:
    code = f.read()

state_injection = """
  const [isCleaning, setIsCleaning] = useState(false);
  
  const handleCleanup = () => {
      setIsCleaning(true);
      fetch(`/api/cleanup?workspace=${currentWorkspace}`, { method: 'POST' })
          .then(r => r.json())
          .then(res => {
              setIsCleaning(false);
              if(res.success) alert("Waschanlage beendet! Der Graph wurde bereinigt.");
          })
          .catch(e => {
              setIsCleaning(false);
              alert("Fehler bei der Bereinigung!");
          });
  };
"""
if "const handleCleanup" not in code:
    code = code.replace("const [masterGraphData, setMasterGraphData] = useState", state_injection + "\n  const [masterGraphData, setMasterGraphData] = useState")

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("UI fixed!")
