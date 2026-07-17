rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function admin() {
      return signedIn() && request.auth.token.admin == true;
    }

    function owner(uid) {
      return signedIn() && request.auth.uid == uid;
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
        || (
          signedIn()
          && resource.data.ownerUid == request.auth.uid
        );

      allow update: if admin()
        || (
          signedIn()
          && resource.data.ownerUid == request.auth.uid
          && request.resource.data.ownerUid == request.auth.uid
          && request.resource.data.status in [
            'draft',
            'pending',
            'changes_requested'
          ]
        );

      allow delete: if admin()
        || (
          signedIn()
          && resource.data.ownerUid == request.auth.uid
          && resource.data.status == 'draft'
        );
    }

    match /users/{userId} {
      allow read: if admin() || owner(userId);
      allow create: if owner(userId);

      allow update: if admin()
        || (
          owner(userId)
          && request.resource.data.role == resource.data.role
        );

      allow delete: if admin() || owner(userId);

      match /garage/{scanId} {
        allow read, create, update, delete:
          if owner(userId) || admin();
      }
    }

    match /reports/{reportId} {
      allow create: if signedIn();
      allow read, update, delete: if admin();
    }
  }
}
