import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { useState } from 'react';

export const emitter = new EventEmitter();
export const read = readFileSync;
export const state = useState;
