import folder_paths
from server import PromptServer
from aiohttp import web
import json

# --- GLOBAL STORAGE ---
if not hasattr(folder_paths, "_global_store"):
    folder_paths._global_store = {}
GLOBAL_STORE = folder_paths._global_store

if not hasattr(folder_paths, "_global_types"):
    folder_paths._global_types = {}
GLOBAL_TYPES = folder_paths._global_types


# --- TYPE DETECTION ---
def get_comfy_type(value):
    """Determine the ComfyUI type of a value."""
    if value is None:
        return "*"
    
    type_name = type(value).__name__
    
    # Tensor-like (torch.Tensor, numpy array)
    if hasattr(value, 'shape'):
        shape = value.shape
        if len(shape) == 4:  # BHWC or BCHW
            if shape[-1] in [1, 3, 4]:  # HWC format
                return "IMAGE"
            if shape[1] in [1, 3, 4]:  # CHW format
                return "IMAGE"
            if shape[1] in [4, 8, 16]:  # Latent channels
                return "LATENT"
        if len(shape) == 3:  # BHW format
            return "MASK"
        if len(shape) == 2:
            return "MASK"
    
    # Dict types
    if isinstance(value, dict):
        if 'samples' in value:
            return "LATENT"
        return "*"
    
    # List types (often CONDITIONING)
    if isinstance(value, list):
        if len(value) > 0:
            item = value[0]
            if isinstance(item, dict) and ('pooled_output' in item or 'cond' in item):
                return "CONDITIONING"
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                return "CONDITIONING"
        return "*"
    
    # Primitives
    if isinstance(value, bool):
        return "BOOLEAN"
    if isinstance(value, int):
        return "INT"
    if isinstance(value, float):
        return "FLOAT"
    if isinstance(value, str):
        return "STRING"
    
    # Model types by class name
    cls_name = type(value).__name__
    model_types = {
        'ModelPatcher': 'MODEL',
        'CLIP': 'CLIP',
        'VAE': 'VAE',
        'ControlNet': 'CONTROL_NET',
        'T2IAdapter': 'CONTROL_NET',
    }
    for key, val in model_types.items():
        if key in cls_name:
            return val
    
    return "*"


# --- ANY TYPE (for Python validation bypass) ---
class AnyType(str):
    def __eq__(self, other):
        return True
    def __ne__(self, other):
        return False
    def __hash__(self):
        return hash("*")

any_type = AnyType("*")


class SetNodeGlobal:
    """Sets a global variable by name with type tracking."""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "variable_name": ("STRING", {"default": "my_variable"}),
            },
            "optional": {
                "value": (any_type, {}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (any_type, "STRING")
    RETURN_NAMES = ("value", "trigger")
    FUNCTION = "execute"
    CATEGORY = "KJNodes/Variables"
    OUTPUT_NODE = True

    def execute(self, variable_name, unique_id=None, value=None):
        if value is not None:
            detected_type = get_comfy_type(value)
            GLOBAL_STORE[variable_name] = value
            GLOBAL_TYPES[variable_name] = detected_type
            
            # Send type update to frontend
            if hasattr(PromptServer, "instance"):
                PromptServer.instance.send_sync("kjnodes.type_update", {
                    "variable_name": variable_name,
                    "type": detected_type,
                    "node_id": unique_id,
                })
            
            print(f"✅ [Set] '{variable_name}' = {detected_type}")
        
        return (value, variable_name)


class GetNodeGlobal:
    """Gets a global variable by name."""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "variable_name": ("STRING", {"default": "my_variable"}),
            },
            "optional": {
                "_trigger": (any_type, {"forceInput": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("value",)
    FUNCTION = "execute"
    CATEGORY = "KJNodes/Variables"

    def execute(self, variable_name, unique_id=None, _trigger=None):
        if variable_name in GLOBAL_STORE:
            value = GLOBAL_STORE[variable_name]
            var_type = GLOBAL_TYPES.get(variable_name, "*")
            print(f"📥 [Get] '{variable_name}' : {var_type}")
            return (value,)
        else:
            available = list(GLOBAL_STORE.keys())
            raise ValueError(f"Variable '{variable_name}' not found. Available: {available}")


# --- API ENDPOINTS ---
if hasattr(PromptServer, "instance"):
    
    @PromptServer.instance.routes.get("/kjnodes/global_types")
    async def get_all_types(request):
        """Get all variable types."""
        return web.json_response(GLOBAL_TYPES)
    
    @PromptServer.instance.routes.get("/kjnodes/global_type/{name}")
    async def get_var_type(request):
        """Get type for specific variable."""
        name = request.match_info.get('name', '')
        return web.json_response({
            "name": name,
            "type": GLOBAL_TYPES.get(name, "*"),
            "exists": name in GLOBAL_STORE
        })


# --- PROMPT HANDLER (Auto-connect) ---
def auto_connect_globals(json_data):
    """Auto-connect Set→Get nodes by variable name."""
    try:
        prompt = json_data.get("prompt", json_data)
        if not isinstance(prompt, dict):
            return json_data
        
        # Find all Set nodes
        set_nodes = {}
        for node_id, node_data in prompt.items():
            if isinstance(node_data, dict) and node_data.get("class_type") == "SetNodeGlobal":
                var_name = node_data.get("inputs", {}).get("variable_name", "")
                if var_name:
                    set_nodes[var_name] = node_id
        
        # Connect matching Get nodes
        for node_id, node_data in prompt.items():
            if isinstance(node_data, dict) and node_data.get("class_type") == "GetNodeGlobal":
                var_name = node_data.get("inputs", {}).get("variable_name", "")
                if var_name in set_nodes:
                    node_data["inputs"]["_trigger"] = [set_nodes[var_name], 1]
                    print(f"🔗 [AutoConnect] {var_name}: {set_nodes[var_name]} → {node_id}")
        
        return json_data
    except Exception as e:
        print(f"⚠️ [AutoConnect] {e}")
        return json_data


if hasattr(PromptServer, "instance"):
    PromptServer.instance.add_on_prompt_handler(auto_connect_globals)
    print("✅ [NodesGlobal] Initialized")


NODE_CLASS_MAPPINGS = {
    "SetNodeGlobal": SetNodeGlobal,
    "GetNodeGlobal": GetNodeGlobal,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SetNodeGlobal": "🔹 Set Global Variable",
    "GetNodeGlobal": "🔹 Get Global Variable",
}
