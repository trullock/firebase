# firebase-helpers
Collection of firebase conveniences

## Persistence

### `firestorePath(pathSegments)`

Turns an array of stuff into a firestore db path

```
let path = firestorePath([MyClass, '123']);
// path === 'MyClass/123'
```

### `getEntity(firestore, pathSegments)`

Loads a domain entity from the db, pass in a `firestore` db instance and an array of path segments to your db object

```
import { getFirestore } from 'firebase-admin/firestore'
import { MyClass } from './myClass.js'
const firestore = getFirestore();

let myClass = await getEntity(firestore. [MyClass, '123'])
```

### `saveEntity(firestore, entity, pathSegments)`

Saves a domain entity into the db, pass in a `firestore` db instance, your entity and an array of path segments to your db object

```
import { getFirestore } from 'firebase-admin/firestore'
import { MyClass } from './myClass.js'
const firestore = getFirestore();

let myClass = new MyClass();

await saveEntity(firestore. myClass, [MyClass, '123'])
```