import { create } from 'zustand';
import type { Friend, Group } from '../types';

interface ContactState {
  friends: Friend[];
  groups: Group[];
  setFriends: (friends: Friend[]) => void;
  setGroups: (groups: Group[]) => void;
  addFriend: (friend: Friend) => void;
  addGroup: (group: Group) => void;
  removeFriend: (userId: string) => void;
}

export const useContactStore = create<ContactState>((set) => ({
  friends: [],
  groups: [],
  setFriends: (friends) => set({ friends }),
  setGroups: (groups) => set({ groups }),
  addFriend: (friend) =>
    set((state) => ({ friends: [...state.friends, friend] })),
  addGroup: (group) =>
    set((state) => ({ groups: [...state.groups, group] })),
  removeFriend: (userId: string) =>
    set((state) => ({ friends: state.friends.filter((f) => f.userId !== userId) })),
}));
