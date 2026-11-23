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

let myClass = await getEntity(firestore, [MyClass, '123'])
```

### `saveEntity(firestore, entity, pathSegments)`

Saves a domain entity into the db, pass in a `firestore` db instance, your entity and an array of path segments to your db object

```
import { getFirestore } from 'firebase-admin/firestore'
import { MyClass } from './myClass.js'
const firestore = getFirestore();

let myClass = new MyClass();

await saveEntity(firestore, myClass, [MyClass, '123'])
```

## Publishing

Bump the version in a package's `package.json` and push to `main`: `.github/workflows/publish.yml` tests and publishes every package whose version is newer than the one on npm. No token or 2FA code is needed, as npm trusts the workflow. If a release needs a new version of another of these packages, publish that one first.

Each package needs setting up once, after its first version has been published by hand:

```
npm trust github @trullock/<name> --repo trullock/firebase --file publish.yml --allow-publish
```

npm drops this if nothing is published within 2 days, so do it just before releasing the package. If it was set up too late and the publish failed, rerun the workflow.
