"""Blender GLB import + independent visual check, without installing an addon."""
import pathlib, math
import bpy
from mathutils import Vector

root = pathlib.Path(__file__).resolve().parents[2]
folder = root/'dev-maps/vice-city'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(folder/'oceandrv.glb'))
world = bpy.data.worlds.new('Daylight'); bpy.context.scene.world = world
world.use_nodes = True; world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32,0.59,0.8,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
bpy.ops.object.camera_add(location=(273,-1310,14))
camera = bpy.context.object
camera.rotation_euler = (Vector((242,-1160,18))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens = 30; bpy.context.scene.camera = camera
bpy.ops.mesh.primitive_plane_add(size=6000,location=(0,0,5.98))
water = bpy.context.object; water.name='Water level from water.dat'
mat = bpy.data.materials.new('Water'); mat.diffuse_color=(0.12,0.37,0.45,1); water.data.materials.append(mat)
scene = bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=8
scene.render.resolution_x=960; scene.render.resolution_y=540; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(folder/'ocean-drive-validation.png')
scene.view_settings.view_transform='Standard'
bpy.ops.wm.save_as_mainfile(filepath=str(root/'tools/vice-city-local/ocean-drive-validation.blend'))
bpy.ops.render.render(write_still=True)
print('PILOT_RENDER_OK',scene.render.filepath,flush=True)
