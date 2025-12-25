import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

console.log("🔧 [NodesGlobal] Loading extension...");

// ═══════════════════════════════════════════════════════════════════════════
// TYPE COLORS 
// ═══════════════════════════════════════════════════════════════════════════
const TYPE_COLORS = {
    "IMAGE": "#64B5F6",
    "MASK": "#81C784",
    "LATENT": "#FF8A65",
    "CONDITIONING": "#FFA931",
    "MODEL": "#B39DDB",
    "CLIP": "#FFD500",
    "VAE": "#FF6E6E",
    "CONTROL_NET": "#00D4AA",
    "STRING": "#77DD77",
    "INT": "#7EC8E3",
    "FLOAT": "#CDB4DB",
    "BOOLEAN": "#FFCC80",
    "*": "#AAAAAA",
};

// Variable types cache
const varTypes = {};

// ═══════════════════════════════════════════════════════════════════════════
// GET TYPE FROM SET NODE'S INPUT
// ═══════════════════════════════════════════════════════════════════════════
function getInputTypeFromNode(node) {
    if (!node.inputs) return "*";
    
    // Find connected input
    for (const input of node.inputs) {
        if (input.link != null && input.name !== "_trigger") {
            const link = app.graph.links[input.link];
            if (link) {
                const sourceNode = app.graph.getNodeById(link.origin_id);
                if (sourceNode?.outputs?.[link.origin_slot]) {
                    const sourceType = sourceNode.outputs[link.origin_slot].type;
                    if (sourceType && sourceType !== "*") {
                        return sourceType;
                    }
                }
            }
        }
    }
    return "*";
}

// ═══════════════════════════════════════════════════════════════════════════
// FIND SET NODE BY VARIABLE NAME
// ═══════════════════════════════════════════════════════════════════════════
function findSetNodeByVarName(varName) {
    if (!app.graph?._nodes) return null;
    for (const node of app.graph._nodes) {
        if (node.type === "SetNodeGlobal") {
            const widget = node.widgets?.find(w => w.name === "variable_name");
            if (widget?.value === varName) {
                return node;
            }
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET VARIABLE TYPE (from Set node or cache)
// ═══════════════════════════════════════════════════════════════════════════
function getVarType(varName) {
    if (!varName) return "*";
    
    // Try to get from Set node directly
    const setNode = findSetNodeByVarName(varName);
    if (setNode) {
        const type = getInputTypeFromNode(setNode);
        if (type !== "*") {
            varTypes[varName] = type;
            return type;
        }
    }
    
    // Fallback to cache
    return varTypes[varName] || "*";
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE OUTPUT SLOT
// ═══════════════════════════════════════════════════════════════════════════
function updateSlotType(node, slotIdx, typeName) {
    if (!node.outputs?.[slotIdx]) return;
    
    const slot = node.outputs[slotIdx];
    const oldType = slot.type;
    
    slot.type = typeName;
    slot.name = typeName === "*" ? "value" : typeName;
    
    // Color
    const color = TYPE_COLORS[typeName] || TYPE_COLORS["*"];
    slot.color_on = color;
    slot.color_off = color;
    
    if (oldType !== typeName) {
        node.setDirtyCanvas(true, true);
        console.log(`[NodesGlobal] Node ${node.id}: ${oldType} → ${typeName}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE ALL GET NODES FOR VARIABLE
// ═══════════════════════════════════════════════════════════════════════════
function updateAllGetNodes(varName, typeName) {
    if (!app.graph?._nodes) return;
    for (const node of app.graph._nodes) {
        if (node.type === "GetNodeGlobal") {
            const widget = node.widgets?.find(w => w.name === "variable_name");
            if (widget?.value === varName) {
                updateSlotType(node, 0, typeName);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// REFRESH ALL GLOBAL NODES TYPES
// ═══════════════════════════════════════════════════════════════════════════
function refreshAllTypes() {
    if (!app.graph?._nodes) return;
    
    // First pass: update all Set nodes and collect types
    for (const node of app.graph._nodes) {
        if (node.type === "SetNodeGlobal") {
            const widget = node.widgets?.find(w => w.name === "variable_name");
            if (widget?.value) {
                const inputType = getInputTypeFromNode(node);
                varTypes[widget.value] = inputType;
                updateSlotType(node, 0, inputType);
            }
        }
    }
    
    // Second pass: update all Get nodes
    for (const node of app.graph._nodes) {
        if (node.type === "GetNodeGlobal") {
            const widget = node.widgets?.find(w => w.name === "variable_name");
            if (widget?.value) {
                const type = varTypes[widget.value] || "*";
                updateSlotType(node, 0, type);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH: Override getNodeMenuOptions for connection filtering
// ═══════════════════════════════════════════════════════════════════════════
function patchConnectionMenu() {
    const origGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
    
    LGraphCanvas.prototype.getNodeMenuOptions = function(node) {
        // Refresh types before showing menu
        if (node.type === "SetNodeGlobal" || node.type === "GetNodeGlobal") {
            const widget = node.widgets?.find(w => w.name === "variable_name");
            if (widget?.value) {
                const type = getVarType(widget.value);
                updateSlotType(node, 0, type);
            }
        }
        return origGetNodeMenuOptions.call(this, node);
    };
    
    console.log("[NodesGlobal] Patched getNodeMenuOptions");
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH: Override showConnectionMenu for proper type filtering
// ═══════════════════════════════════════════════════════════════════════════
function patchShowConnectionMenu() {
    // Store original
    const originalShowConnectionMenu = LGraphCanvas.prototype.showConnectionMenu;
    
    LGraphCanvas.prototype.showConnectionMenu = function(optPass) {
        // Before showing menu, update the slot type for our nodes
        if (this.connecting_node) {
            const node = this.connecting_node;
            if (node.type === "SetNodeGlobal" || node.type === "GetNodeGlobal") {
                const widget = node.widgets?.find(w => w.name === "variable_name");
                if (widget?.value) {
                    const type = getVarType(widget.value);
                    const slotIdx = this.connecting_slot;
                    if (node.outputs?.[slotIdx]) {
                        node.outputs[slotIdx].type = type;
                        console.log(`[NodesGlobal] Connection menu: forcing type ${type}`);
                    }
                }
            }
        }
        
        return originalShowConnectionMenu.call(this, optPass);
    };
    
    console.log("[NodesGlobal] Patched showConnectionMenu");
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH: Override processContextMenu for search box filtering
// ═══════════════════════════════════════════════════════════════════════════
function patchSearchBox() {
    const originalShowSearchBox = LGraphCanvas.prototype.showSearchBox;
    
    LGraphCanvas.prototype.showSearchBox = function(event, options) {
        // Check if we're connecting from our nodes
        if (options?.slot_from && options?.node_from) {
            const node = options.node_from;
            if (node.type === "SetNodeGlobal" || node.type === "GetNodeGlobal") {
                const widget = node.widgets?.find(w => w.name === "variable_name");
                if (widget?.value) {
                    const type = getVarType(widget.value);
                    // Override the type in slot_from
                    if (options.slot_from) {
                        options.type_filter_in = type;
                        options.slot_from.type = type;
                        console.log(`[NodesGlobal] SearchBox: type filter = ${type}`);
                    }
                }
            }
        }
        
        return originalShowSearchBox.call(this, event, options);
    };
    
    console.log("[NodesGlobal] Patched showSearchBox");
}

// ═══════════════════════════════════════════════════════════════════════════
// NODE SETUP: SetNodeGlobal
// ═══════════════════════════════════════════════════════════════════════════
function setupSetNode(node) {
    const widget = node.widgets?.find(w => w.name === "variable_name");
    if (!widget) return;
    
    // On connection change
    const origOnConnChange = node.onConnectionsChange;
    node.onConnectionsChange = function(side, slotIdx, isConnected, linkInfo, ioSlot) {
        origOnConnChange?.apply(this, arguments);
        
        // Input side
        if (side === 1) {
            const varName = widget.value;
            const inputType = getInputTypeFromNode(this);
            
            varTypes[varName] = inputType;
            updateSlotType(this, 0, inputType);
            updateAllGetNodes(varName, inputType);
            
            console.log(`[NodesGlobal] Set "${varName}" connection changed → ${inputType}`);
        }
    };
    
    // On variable name change
    const origCallback = widget.callback;
    widget.callback = function(value, ...args) {
        origCallback?.call(this, value, ...args);
        
        const inputType = getInputTypeFromNode(node);
        varTypes[value] = inputType;
        updateSlotType(node, 0, inputType);
        updateAllGetNodes(value, inputType);
    };
    
    // Initial
    setTimeout(() => {
        const inputType = getInputTypeFromNode(node);
        varTypes[widget.value] = inputType;
        updateSlotType(node, 0, inputType);
    }, 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// NODE SETUP: GetNodeGlobal
// ═══════════════════════════════════════════════════════════════════════════
function setupGetNode(node) {
    const widget = node.widgets?.find(w => w.name === "variable_name");
    if (!widget) return;
    
    // On variable name change
    const origCallback = widget.callback;
    widget.callback = function(value, ...args) {
        origCallback?.call(this, value, ...args);
        
        const type = getVarType(value);
        updateSlotType(node, 0, type);
    };
    
    // Initial
    setTimeout(() => {
        const type = getVarType(widget.value);
        updateSlotType(node, 0, type);
    }, 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTER EXTENSION
// ═══════════════════════════════════════════════════════════════════════════
app.registerExtension({
    name: "KJNodes.GlobalVariables",
    
    async setup() {
        console.log("[NodesGlobal] Setup started");
        
        // Apply patches
        patchConnectionMenu();
        patchShowConnectionMenu();
        patchSearchBox();
        
        // Listen for server type updates
        api.addEventListener("kjnodes.type_update", (event) => {
            const { variable_name, type } = event.detail;
            console.log(`[NodesGlobal] Server update: ${variable_name} = ${type}`);
            varTypes[variable_name] = type;
            updateAllGetNodes(variable_name, type);
        });
        
        // Refresh after execution
        api.addEventListener("executed", () => {
            refreshAllTypes();
        });
        
        // Periodic refresh
        setInterval(refreshAllTypes, 2000);
        
        // Initial refresh
        setTimeout(refreshAllTypes, 500);
        
        console.log("[NodesGlobal] Setup complete");
    },
    
    nodeCreated(node) {
        if (node.type === "SetNodeGlobal") {
            setupSetNode(node);
        } else if (node.type === "GetNodeGlobal") {
            setupGetNode(node);
        }
    },
    
    loadedGraphNode(node) {
        if (node.type === "SetNodeGlobal") {
            setupSetNode(node);
        } else if (node.type === "GetNodeGlobal") {
            setupGetNode(node);
        }
    },
});

console.log("✅ [NodesGlobal] Extension registered");
