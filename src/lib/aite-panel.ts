import { fixedDoorPair } from '../data/fixed-door-variants';
import { HOUSE_DOORWAYS, type HouseDoorway } from '../data/house-doorways';
import { HOUSE_ROOM_FLOORS, type RoomFloor } from '../data/room-floors';
export type DoorSide = 'left' | 'right';
export function getHouseDoorways(productId: string, doorSide?: DoorSide): readonly HouseDoorway[] {
  const pair = fixedDoorPair(productId);
  const doors = HOUSE_DOORWAYS[pair?.right ?? productId] ?? [];
  if (!pair || (productId !== pair.left && doorSide !== 'left')) return doors;
  return doors.map(door => { const center: HouseDoorway['center'] = [...door.center]; center[pair.axis] = pair.span - center[pair.axis]; return { ...door, center }; });
}
export function getHouseRoomFloors(productId: string, doorSide?: DoorSide): readonly RoomFloor[] {
  const pair = fixedDoorPair(productId), base = pair?.right ?? productId;
  const rooms = HOUSE_ROOM_FLOORS[base] ?? [];
  if (!pair || (productId !== pair.left && doorSide !== 'left')) return rooms;
  if (base !== 'milk-house-aite') return rooms.map(room => room.id === 'entry' ? { ...room, entry: getHouseDoorways(productId, doorSide)[0].center } : room);
  return rooms.map(room => room.id === 'inner' ? { ...room, id: 'entry', depth: 1, entry: [50,0,0] } : { ...room, id: 'inner', depth: 2, entry: [150,93,0] });
}
