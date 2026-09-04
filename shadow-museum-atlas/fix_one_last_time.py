with open('src/App.tsx', 'r') as f:
    code = f.read()

code = code.replace(
"""            {/* Focus Mode Toggle */}
            <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontWeight: 'bold', fontSize: '12px' }}>FOCUS MODE:</label>
                   onClick={() => setFocusMode(!focusMode)} 
                   style={{ 
                       padding: '5px 10px', 
                       backgroundColor: focusMode ? '#10B981' : '#FFF', 
                       color: focusMode ? '#FFF' : '#000', 
                       border: '2px solid #000', 
                       cursor: 'pointer', 
                       fontWeight: 'bold' 
                   }}>
                   {focusMode ? 'ON' : 'OFF'}
            </div>""",
"""            {/* Focus Mode Toggle */}
            <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontWeight: 'bold', fontSize: '12px' }}>FOCUS MODE:</label>
                   <button onClick={() => setFocusMode(!focusMode)} 
                   style={{ 
                       padding: '5px 10px', 
                       backgroundColor: focusMode ? '#10B981' : '#FFF', 
                       color: focusMode ? '#FFF' : '#000', 
                       border: '2px solid #000', 
                       cursor: 'pointer', 
                       fontWeight: 'bold' 
                   }}>
                   {focusMode ? 'ON' : 'OFF'}
                   </button>
            </div>"""
)

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("Applied very last fix")
