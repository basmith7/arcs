//! Step 4's tracker (packages/engine/src/tracker.ts), ported operation for operation: interned
//! dense ids in a shared append-only `Space`, an entity -> location array copied per change, an
//! outer per-location array copied per change with only the touched lists replaced, and a new
//! tracker value per change. Entities in lists are interned indices — the Rust analogue of the
//! TS lists' references to interned strings. Every location rule in the engine is allow-all.
use crate::fx::FxMap;
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Default)]
pub struct Space {
    entity_index: FxMap<Box<str>, u32>,
    pub entities: Vec<Box<str>>,
    location_index: FxMap<Box<str>, u32>,
    pub locations: Vec<Box<str>>,
}

impl Space {
    fn entity(&mut self, e: &str) -> u32 {
        if let Some(&i) = self.entity_index.get(e) {
            return i;
        }
        let i = self.entities.len() as u32;
        self.entities.push(e.into());
        self.entity_index.insert(e.into(), i);
        i
    }
    fn location(&mut self, l: &str) -> u32 {
        if let Some(&i) = self.location_index.get(l) {
            return i;
        }
        let i = self.locations.len() as u32;
        self.locations.push(l.into());
        self.location_index.insert(l.into(), i);
        i
    }
}

type Rule = fn(u32) -> bool;
fn allow_all(_: u32) -> bool {
    true
}

#[derive(Clone)]
pub struct Tracker {
    pub space: Rc<RefCell<Space>>,
    where_: Rc<Vec<i32>>,
    lists: Rc<Vec<Option<Rc<Vec<u32>>>>>,
    rule_of: Rc<Vec<Option<Rule>>>,
}

impl Tracker {
    pub fn empty() -> Tracker {
        Tracker { space: Rc::new(RefCell::new(Space::default())), where_: Rc::new(vec![]), lists: Rc::new(vec![]), rule_of: Rc::new(vec![]) }
    }
    fn where_is(&self, space: &Space, entity: &str) -> i32 {
        match space.entity_index.get(entity) {
            Some(&e) if (e as usize) < self.where_.len() => self.where_[e as usize],
            _ => -1,
        }
    }
    fn registered(&self, space: &Space, location: &str) -> i32 {
        match space.location_index.get(location) {
            Some(&l) if (l as usize) < self.lists.len() && self.lists[l as usize].is_some() => l as i32,
            _ => -1,
        }
    }
    fn widened(&self, n: usize) -> Vec<i32> {
        let mut out = vec![-1; n];
        out[..self.where_.len()].copy_from_slice(&self.where_);
        out
    }
    fn lists_with(&self, n: usize) -> Vec<Option<Rc<Vec<u32>>>> {
        let mut v = (*self.lists).clone();
        v.resize(n.max(v.len()), None);
        v
    }

    pub fn register(&self, location: &str, contents: &[&str]) -> Result<Tracker, String> {
        let mut space = self.space.borrow_mut();
        if self.registered(&space, location) >= 0 {
            return Err(format!("location already registered: {location}"));
        }
        let rule: Rule = allow_all;
        let l = space.location(location);
        let ids: Vec<u32> = contents.iter().map(|e| space.entity(e)).collect();
        let mut where_ = self.widened(space.entities.len());
        for (k, &e) in ids.iter().enumerate() {
            if where_[e as usize] >= 0 {
                return Err(format!("entity already placed: {}", contents[k]));
            }
            if !rule(e) {
                return Err(format!("entity not allowed at {location}"));
            }
            where_[e as usize] = l as i32;
        }
        let mut lists = self.lists_with(l as usize + 1);
        lists[l as usize] = Some(Rc::new(ids));
        let mut rule_of = (*self.rule_of).clone();
        rule_of.resize((l as usize + 1).max(rule_of.len()), None);
        rule_of[l as usize] = Some(rule);
        Ok(Tracker { space: self.space.clone(), where_: Rc::new(where_), lists: Rc::new(lists), rule_of: Rc::new(rule_of) })
    }

    pub fn has(&self, location: &str) -> bool {
        self.registered(&self.space.borrow(), location) >= 0
    }

    pub fn contents_of(&self, location: &str) -> Result<&[u32], String> {
        let l = self.registered(&self.space.borrow(), location);
        if l < 0 {
            return Err(format!("location not registered: {location}"));
        }
        Ok(self.lists[l as usize].as_ref().unwrap().as_slice())
    }

    /// Location index, or -1. (TS returns the location string; the index names the same string.)
    pub fn location_of(&self, entity: &str) -> i32 {
        self.where_is(&self.space.borrow(), entity)
    }

    /// `None` when the move is a no-op (TS returns the same tracker object).
    pub fn move_to(&self, entity: &str, to: &str) -> Result<Option<Tracker>, String> {
        let space = self.space.borrow();
        let from = self.where_is(&space, entity);
        if from < 0 {
            return Err(format!("entity not registered: {entity}"));
        }
        let l = self.registered(&space, to);
        if l < 0 {
            return Err(format!("location not registered: {to}"));
        }
        let e = *space.entity_index.get(entity).unwrap();
        if !(self.rule_of[l as usize].unwrap())(e) {
            return Err(format!("entity not allowed at {to}"));
        }
        if from == l {
            return Ok(None);
        }
        let mut lists = (*self.lists).clone();
        let old_from = self.lists[from as usize].as_ref().unwrap();
        lists[from as usize] = Some(Rc::new(old_from.iter().copied().filter(|&x| x != e).collect()));
        let old_to = self.lists[l as usize].as_ref().unwrap();
        let mut to_list = Vec::with_capacity(old_to.len() + 1);
        to_list.extend_from_slice(old_to);
        to_list.push(e);
        lists[l as usize] = Some(Rc::new(to_list));
        let mut where_ = (*self.where_).clone();
        where_[e as usize] = l;
        Ok(Some(Tracker { space: self.space.clone(), where_: Rc::new(where_), lists: Rc::new(lists), rule_of: self.rule_of.clone() }))
    }

    pub fn place(&self, entities: &[&str], location: &str) -> Result<Tracker, String> {
        let mut space = self.space.borrow_mut();
        let l = self.registered(&space, location);
        if l < 0 {
            return Err(format!("location not registered: {location}"));
        }
        let rule = self.rule_of[l as usize].unwrap();
        let ids: Vec<u32> = entities.iter().map(|e| space.entity(e)).collect();
        let mut where_ = self.widened(space.entities.len());
        let mut list = self.lists[l as usize].as_ref().unwrap().to_vec();
        for (k, &e) in ids.iter().enumerate() {
            if where_[e as usize] >= 0 {
                return Err(format!("entity already placed: {}", entities[k]));
            }
            if !rule(e) {
                return Err(format!("entity not allowed at {location}"));
            }
            where_[e as usize] = l;
            list.push(e);
        }
        let mut lists = (*self.lists).clone();
        lists[l as usize] = Some(Rc::new(list));
        Ok(Tracker { space: self.space.clone(), where_: Rc::new(where_), lists: Rc::new(lists), rule_of: self.rule_of.clone() })
    }
}
