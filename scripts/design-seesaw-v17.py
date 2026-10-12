#!/usr/bin/env python3
"""Rebuild only SS01; preserve the other 44 print groups and their steel cavities."""
from pathlib import Path
import argparse, copy, json, math, shutil
import numpy as np
import trimesh
import manifold3d as mf
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

def union(*solids): return mf.Manifold.batch_boolean(list(solids), mf.OpType.Add)
def cube(lo, hi): return mf.Manifold.cube(tuple(b-a for a,b in zip(lo,hi))).translate(lo)
def extrude(poly,z0,z1):
    polys=[poly] if poly.geom_type=='Polygon' else list(poly.geoms)
    rings=[]
    for p in polys:
        rings.append(np.asarray(p.exterior.coords[:-1])); rings.extend(np.asarray(r.coords[:-1]) for r in p.interiors)
    return mf.Manifold.extrude(mf.CrossSection(rings,mf.FillRule.EvenOdd),z1-z0).translate((0,0,z0))
def mesh(s):
    m=s.to_mesh64(); return trimesh.Trimesh(np.asarray(m.vert_properties)[:,:3],np.asarray(m.tri_verts),process=True)
def canonical(s):
    for tol in [.0005,.001,.003,.005,.01]:
        q=s.as_original().simplify(tol); m=q.to_mesh();m.merge();q=mf.Manifold(m).as_original().simplify(tol)
        m=q.to_mesh();m.merge();q=mf.Manifold(m);tm=mesh(q)
        if tm.is_watertight and tm.is_winding_consistent and tm.volume>0:return q
    raise AssertionError('non-manifold print mesh')
def rotate(s,a,pivot): return s.translate((0,0,-pivot)).rotate((0,a,0)).translate((0,0,pivot))
def rounded_rect(x0,y0,x1,y1,r):return box(x0,y0,x1,y1).buffer(-r,quad_segs=12).buffer(r,quad_segs=12)

def design():
    angle=32.; default=30.
    # 180mm walking surface, one 100mm grid cell wide. Both side faces touch the
    # bed in the assembled print orientation; no hanging board edge at layer one.
    deck=extrude(rounded_rect(-90,-50,90,50,4).buffer(-.6,quad_segs=12),9.,11.).minkowski_sum(mf.Manifold.sphere(.6,16))
    ribs=[]
    for x in range(-80,81,10):
        core=extrude(rounded_rect(x-1.,-46,x+1.,46,.9),11.4,12.4)
        ribs.append(core.minkowski_sum(mf.Manifold.sphere(.4,16)))
    surface=union(deck,*ribs)
    # Solve the pivot height from the real rounded mesh, not its bounding-box diagonal.
    pivot=100.-surface.rotate((0,angle,0)).bounding_box()[5]
    surface=surface.translate((0,0,pivot))
    def ycyl(y0,y1,r0,r1=None):
        return mf.Manifold.cylinder(y1-y0,r0,r0 if r1 is None else r1,96).rotate((-90,0,0)).translate((0,y0,pivot))
    shaft=ycyl(-50,50,4)
    for y in [-30,30]:shaft=union(shaft,ycyl(y-2.5,y-1,4,5.5),ycyl(y-1,y+1,5.5),ycyl(y+1,y+2.5,5.5,4))
    moving=union(surface,shaft,cube((-1.6,-50,pivot+2.9),(1.6,50,pivot+8.9)))
    a=math.radians(angle);stop_x=14.;stop_r=.8
    stop_z=pivot+(8.4-stop_r-stop_x*math.sin(a))/math.cos(a)
    foot=rounded_rect(-18,0,18,5.4,1.5)
    profile=unary_union([foot,*[Point(x,stop_z).buffer(stop_r,quad_segs=24) for x in [-stop_x,stop_x]]]).convex_hull.union(Point(0,pivot).buffer(8.2,quad_segs=48))
    gap_angle=60
    slot=Polygon([(0,pivot),(-80*math.sin(math.radians(gap_angle)),pivot+80*math.cos(math.radians(gap_angle))),(80*math.sin(math.radians(gap_angle)),pivot+80*math.cos(math.radians(gap_angle)))])
    profile=profile.difference(slot).buffer(-.5,quad_segs=12).buffer(.5,quad_segs=12)
    fixed=extrude(profile,-50,50).rotate((90,0,0))
    bore=ycyl(-50.1,50.1,4.4)
    for y in [-30,30]:bore=union(bore,ycyl(y-2.85,y-1.35,4.4,5.9),ycyl(y-1.35,y+1.35,5.9),ycyl(y+1.35,y+2.85,5.9,4.4))
    fixed-=bore
    for x in [-10,10]:
        for y in [-40,40]:fixed-=mf.Manifold.cylinder(4.3,4.1,4.1,96).translate((x,y,-.1))
    motions=[]; bounds=[]
    for a in np.linspace(-angle,angle,65):
        moved=rotate(moving,float(a),pivot); collision=abs((fixed^moved).volume()); bb=moved.bounding_box()
        assert collision<.02,(a,collision)
        assert bb[2]>=0 and bb[5]<=100.001,(a,bb)
        motions.append(dict(angle=float(a),intersection_mm3=collision,highest_mm=bb[5],lowest_mm=bb[2])); bounds.append(bb)
    for a in [-33,33]:assert abs((fixed^rotate(moving,a,pivot)).volume())>1,(a,'missing stop')
    posed=rotate(moving,default,pivot)
    gap=fixed.min_gap(posed,2);assert gap>.3,('print gap',gap)
    magnet_checks=[]
    for x in [-10,10]:
        for y in [-40,40]:
            probe=mf.Manifold.cylinder(4,4,4,96).translate((x,y,.05))
            floor=mf.Manifold.cylinder(1,3.9,3.9,96).translate((x,y,4.21))
            assert abs((fixed^probe).volume())<.001
            assert (fixed^floor).volume()/floor.volume()>.999
            magnet_checks.append([x+100,y+250,110])
    bounds=np.asarray(bounds); swing=[*np.minimum(bounds[:,:3].min(0),fixed.bounding_box()[:3]),*np.maximum(bounds[:,3:].max(0),fixed.bounding_box()[3:])]
    spec=dict(length_mm=180,width_mm=100,base_footprint_mm=[36,100],magnet_pitch_mm=[20,80],magnet_centers_world_mm=magnet_checks,magnet_cavity_mm=[8.2,4.2],magnet_size_mm=[8,4],magnet_count=4,pivot_height_mm=pivot,pivot_world_mm=[100,250,110+pivot],limit_angle_deg=angle,default_tilt_deg=default,max_operating_height_mm=100,default_highest_mm=posed.bounding_box()[5],rib_count=17,rib_pitch_mm=10,rib_height_mm=1.2,radial_clearance_mm=.4,axial_clearance_mm=.35,default_body_gap_mm=gap,full_swing_local_bounds_mm=list(map(float,swing)),print_in_place=True,physical_tested=False)
    return fixed,posed,spec,motions

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--previous',type=Path,default=Path('/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_steel_v16'));ap.add_argument('--output',type=Path,default=Path('/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_steel_v17'));args=ap.parse_args()
    root=args.output.resolve();prev=args.previous.resolve();assert root!=prev
    (root/'print_parts').mkdir(parents=True,exist_ok=True);(root/'source').mkdir(exist_ok=True)
    fixed,moving,spec,motions=design();data=json.loads((prev/'assembly_meshes.json').read_text()); groups=[]
    for original in data['groups']:
        if original['id']=='SS01':continue
        g=copy.deepcopy(original)
        for c in g['components']:
            target=root/'print_parts'/Path(c['stl']).name;shutil.copyfile(c['stl'],target);c['stl']=str(target)
        groups.append(g)
    bodies=[('Gold',moving),('PineGreen',fixed)];offset=(100,250,110)
    allpose=union(fixed,moving).translate(offset);printbounds=np.asarray(allpose.rotate((90,0,0)).bounding_box()).reshape(2,3);shift=-printbounds[0]
    cs=[];vertices=[];faces=[];materials=[];vo=0;checks=[]
    for color,s in bodies:
        s=canonical(s.translate(offset));tm=mesh(s);assert tm.is_watertight and tm.is_winding_consistent and tm.volume>0
        printed=mesh(s.rotate((90,0,0)).translate(shift));out=root/'print_parts'/f'SS01_{color}.stl';printed.export(out)
        reloaded=trimesh.load(out,force='mesh');assert reloaded.is_watertight and reloaded.is_winding_consistent
        contact=float(reloaded.area_faces[np.max(reloaded.triangles[:,:,2],axis=1)<.001].sum());assert contact>50,contact
        cs.append(dict(id=f'SS01_{color}',color_key=color,color=data['palette'][color],stl=str(out),vertices=tm.vertices.tolist(),triangles=tm.faces.tolist()))
        vertices.extend(tm.vertices.tolist());faces.extend((tm.faces+vo).tolist());materials.extend([list(data['palette']).index(color)]*len(tm.faces));vo+=len(tm.vertices)
        checks.append(dict(color=color,watertight=True,volume_mm3=float(tm.volume),bed_contact_mm2=contact,triangles=len(tm.faces)))
    g=dict(id='SS01',name='SS01',name_zh='跷跷板_180x100_四磁吸_防滑_最高100mm',components=cs,vertices=vertices,triangles=faces,face_materials=materials,print_rotation=[90,0,0],dimensions_mm=(printbounds[1]-printbounds[0]).tolist(),assembly_bounds_mm=list(allpose.bounding_box()),volume_mm3=allpose.volume(),support_auto=False,brim_width_mm=0,allow_z_rotation=True,bridge_angle=0,is_optional=False,orientation_note='板面与底座双色一体活动打印，侧放，两个实体同时触床；不得自动拆散或给转轴间隙加支撑。底座四个开放磁孔Ø8.2×4.2，装Ø8×4磁铁。径向0.4、轴向0.35mm间隙，约±32°摆动；17条圆角防滑棱。')
    groups.append(g);data.update(groups=groups,version='Steel receivers V17 four-magnet anti-slip seesaw')
    (root/'assembly_meshes.json').write_text(json.dumps(data,ensure_ascii=False))
    manifest=[{**{k:v for k,v in o.items() if k not in ['vertices','triangles','face_materials','components']},'components':[{k:v for k,v in c.items() if k not in ['vertices','triangles']} for c in o['components']]} for o in groups]
    (root/'print_manifest.json').write_text(json.dumps(dict(schema_version=3,units='millimeter',groups=manifest),ensure_ascii=False,indent=2))
    for name in ['embedded_hardware.json','print_profile_overrides.json','magnet_cavities.json','hardware_complete.json']:
        d=json.loads((prev/name).read_text())
        if isinstance(d,list):
            d=[item for item in d if item.get('part')!='SS01']
            if name=='magnet_cavities.json':d.extend(dict(part='SS01',center_xy=p[:2],z_range=[109.9,114.2],diameter_mm=8.2,open_direction='down') for p in spec['magnet_centers_world_mm'])
            if name=='hardware_complete.json':d.extend(dict(part='SS01',center_mm=[*p[:2],112],size_mm=[8,4],axis=[0,0,-1],kind='open',optional=False) for p in spec['magnet_centers_world_mm'])
        (root/name).write_text(json.dumps(d,ensure_ascii=False,indent=2))
    (root/'seesaw_parameters.json').write_text(json.dumps(spec,indent=2));(root/'seesaw_validation.json').write_text(json.dumps(dict(status='passed',spec=spec,meshes=checks,swing=motions,unchanged_groups=44,physical_tested=False),indent=2))
    package=(prev/'package_3mf.py').read_text().replace('V16','V17');(root/'package_3mf.py').write_text(package)
    shutil.copy2(__file__,root/'source/build.py')
    solo=root/'seesaw_only';solo.mkdir(exist_ok=True);(solo/'print_parts').mkdir(exist_ok=True)
    single=copy.deepcopy(manifest[-1])
    for c in single['components']:
        target=solo/'print_parts'/Path(c['stl']).name;shutil.copy2(c['stl'],target);c['stl']=str(target)
    (solo/'print_manifest.json').write_text(json.dumps(dict(schema_version=3,units='millimeter',groups=[single]),ensure_ascii=False,indent=2))
    (solo/'embedded_hardware.json').write_text('[]');(solo/'print_profile_overrides.json').write_text(json.dumps({'SS01':{'wall_generator':'arachne','wall_loops':4,'support_auto':False}}))
    (solo/'package_3mf.py').write_text(package.replace('磁吸泳池别墅_钢片12x2_磁铁8x4_V17_H2C.3mf','跷跷板_180x100_四磁吸_防滑.3mf').replace('磁吸泳池别墅_钢片12x2_磁铁8x4_V17_切片校验.3mf','跷跷板_切片校验.3mf'))
    print(json.dumps(spec,indent=2));print('OUTPUT',root)
if __name__=='__main__':main()
