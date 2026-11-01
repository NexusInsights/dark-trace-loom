export const personSources = [
  { id:"username-search", title:"Find public accounts", description:"Search an exact username on GitHub, GitLab, DEV Community, Hacker News and Keybase.", group:"Accounts" },
  { id:"pdl-person-enrich", title:"Find contact information", description:"Use the existing People Data Labs match to retrieve the contact fields your account can access.", group:"Contacts" },
  { id:"twitter-deep-search", title:"Search public posts", description:"Search X posts using the existing provider and its available history window.", group:"Accounts" },
  { id:"public-records", title:"Search criminal & court records", description:"Search CourtListener's public federal criminal dockets, other federal cases, or court opinions. No API credential required; identity and disposition need source review.", group:"Records" },
  { id:"vin-decoder", title:"Look up a VIN", description:"NHTSA manufacturer specifications. This does not establish ownership or vehicle history.", group:"Assets" },
  { id:"vehicle-lookup", title:"Look up a license plate", description:"CarsXE vehicle fields and VIN where available. Requires state and country; ownership is separate.", group:"Assets" },
  { id:"property-records", title:"Find property & recorded owners", description:"Search official Travis and Williamson County parcel records by owner, address or property ID, including source-reported tax values. No API credential required.", group:"Assets" },
  { id:"lpr", title:"Read a plate from a photo", description:"Extract a plate candidate from an image with the existing local OCR implementation.", group:"Assets" },
  { id:"image-metadata", title:"Inspect a photo", description:"Read available EXIF and camera metadata from an image you supply.", group:"Photos" },
] as const;
