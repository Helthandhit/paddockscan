rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function owner(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    function admin() {
      return signedIn() && request.auth.token.admin == true;
    }

    function validGarageDocument(uid) {
      return request.resource.data.keys().hasOnly([
        'schemaVersion', 'ownerUid', 'scanId', 'registration', 'title',
        'resultJson', 'originalStoragePath', 'cutoutStoragePath',
        'createdAtIso', 'updatedAt'
      ])
      && request.resource.data.ownerUid == uid
      && request.resource.data.scanId is string
      && request.resource.data.scanId.size() >= 8
      && request.resource.data.scanId.size() <= 100
      && request.resource.data.resultJson is string
      && request.resource.data.resultJson.size() <= 500000
      && request.resource.data.originalStoragePath is string
      && request.resource.data.originalStoragePath.matches(
        'users/' + uid + '/garage/' + request.resource.data.scanId + '/original.jpg'
      );
    }

    match /siteSettings/public {
      allow read: if true;
      allow write: if admin();
    }

    match /posts/{postId} {
      allow read: if resource.data.published == true || admin();
      allow create, update, delete: if admin();
    }

    match /submissions/{submissionId} {
      allow create: if signedIn()
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.status in ['draft', 'pending'];

      allow read: if admin()
        || (signedIn() && resource.data.ownerUid == request.auth.uid);

      allow update: if admin()
        || (
          signedIn()
          && resource.data.ownerUid == request.auth.uid
          && request.resource.data.ownerUid == request.auth.uid
          && request.resource.data.status in [
            'draft', 'pending', 'changes_requested'
          ]
        );

      allow delete: if admin()
        || (
          signedIn()
          && resource.data.ownerUid == request.auth.uid
          && resource.data.status == 'draft'
        );
    }

    match /users/{uid} {
      allow read: if owner(uid) || admin();

      allow create: if owner(uid)
        && request.resource.data.role == 'user';

      allow update: if admin()
        || (
          owner(uid)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
            'displayName', 'email', 'location', 'bio', 'website', 'updatedAt'
          ])
        );

      allow delete: if admin() || owner(uid);

      match /garage/{scanId} {
        allow read, delete: if owner(uid) || admin();
        allow create, update: if (owner(uid) || admin())
          && scanId == request.resource.data.scanId
          && validGarageDocument(uid);

        match /history/{historyId} {
          allow read: if owner(uid) || admin();
          allow write: if false;
        }
      }

      match /settings/{document=**} {
        allow read, create, update, delete: if owner(uid);
      }
    }

    match /reports/{reportId} {
      allow create: if signedIn();
      allow read, update, delete: if admin();
    }

    match /scanReservations/{reservationId} {
      allow read, write: if false;
    }

    match /adminAudit/{auditId} {
      allow read, write: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
