"""Blender visual check of the exact assembled print mesh, no web simplification."""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
root=Path('/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_steel_v17')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=1100;scene.render.resolution_y=850;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25);scene.view_settings.view_transform='Standard'
g=next(g for g in json.loads((root/'assembly_meshes.json').read_text())['groups'] if g['id']=='SS01')
for c in g['components']:
 mesh=bpy.data.meshes.new(c['id']);mesh.from_pydata([(x-100,y-250,z-110) for x,y,z in c['vertices']],[],c['triangles']);mesh.update()
 obj=bpy.data.objects.new(c['id'],mesh);bpy.context.collection.objects.link(obj)
 mat=bpy.data.materials.new(c['color_key']);rgba=tuple((v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4) for v in ([243,179,78] if c['color_key']=='Gold' else [23,74,58]))+(1,);mat.diffuse_color=rgba;mat.use_nodes=True
 bsdf=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) or mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled');output=next((n for n in mat.node_tree.nodes if n.type=='OUTPUT_MATERIAL'),None) or mat.node_tree.nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(bsdf.outputs['BSDF'],output.inputs['Surface']);bsdf.inputs['Base Color'].default_value=rgba;bsdf.inputs['Roughness'].default_value=.62;obj.data.materials.append(mat)
for pos,power,size in [((0,-180,270),1700000,180),((-200,120,130),1100000,160),((150,120,-150),1200000,140)]:
 d=bpy.data.lights.new('studio','AREA');d.energy=power/4;d.shape='DISK';d.size=size;o=bpy.data.objects.new('studio',d);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,35))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('camera');cam=bpy.data.objects.new('camera',d);bpy.context.collection.objects.link(cam);scene.camera=cam;d.type='ORTHO';d.ortho_scale=250
(root/'renders').mkdir(exist_ok=True)
for name,position,target in [('seesaw-v17',(260,-310,210),(0,0,45)),('seesaw-v17-bottom',(150,-260,-230),(0,0,30))]:
 cam.location=position;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(root/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(root/'跷跷板_V17.blend'))
